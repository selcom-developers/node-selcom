import { type CredentialsInput, SelcomConfig, type SelcomConfigInput } from "./config.js";
import { SelcomError, TransportError } from "./errors.js";
import {
  type BalanceData,
  type BalanceRequest,
  type BuildContext,
  type CardPaymentRequest,
  type CreateOrderMinimalRequest,
  type CreateOrderRequest,
  type DeleteCardRequest,
  type ListOrdersRequest,
  type LookupRequest,
  type NameLookupData,
  type OperationSpec,
  type OrderCreated,
  type OrderIdRequest,
  type OrderInfo,
  type OrderSummary,
  operations,
  type PayoutData,
  type PayoutRequest,
  type RawData,
  type StoredCard,
  type StoredCardsRequest,
  type TransidRequest,
  type UtilityLookupData,
  type WalletPaymentRequest,
} from "./operations.js";
import { classify, OperationResult, text } from "./results.js";
import { hs256Signer, type Signer, signRequest } from "./signing.js";
import { type Clock, DAR_ES_SALAAM_OFFSET_MINUTES, formatTimestamp } from "./timestamp.js";
import { createFetchTransport, type Transport, type TransportResponse } from "./transport.js";
import { USER_AGENT } from "./version.js";

export interface SelcomClientOptions {
  /** A `SelcomConfig`, or the input to build one (validated now, not on the first call). */
  config: SelcomConfig | SelcomConfigInput;
  /** Replace the HTTP layer: custom client, proxy, logging, a test fake. */
  transport?: Transport;
  /** Your own `fetch` for the default transport. Ignored when `transport` is given. */
  fetch?: typeof fetch;
  /** Source of time for the `Timestamp` header. Defaults to the system clock. */
  clock?: Clock;
  /** Offset of the `Timestamp` header in minutes. Default +180 (Africa/Dar_es_Salaam). */
  timestampOffsetMinutes?: number;
  /** Build a different signer (for example RS256, later) from a credential set. Defaults to HS256. */
  signer?: (credentials: CredentialsInput) => Signer;
}

export interface CallOptions {
  /** Abort the call. Aborting after the request was sent leaves the outcome unknown. */
  signal?: AbortSignal;
}

/**
 * The Selcom client. Stateless between calls: it does not lock, queue or deduplicate, and it
 * never retries a payment or a write. Each method returns an `OperationResult`; when no response
 * arrives it throws `TransportError` (see `classification`).
 */
export class SelcomClient {
  readonly config: SelcomConfig;
  readonly #transport: Transport;
  readonly #clock: Clock;
  readonly #offset: number;
  readonly #signers: { checkout: Signer; payout: Signer };
  readonly #apiKeys: { checkout: string; payout: string };

  constructor(options: SelcomClientOptions) {
    this.config =
      options.config instanceof SelcomConfig ? options.config : new SelcomConfig(options.config);
    this.#transport =
      options.transport ?? createFetchTransport(options.fetch ? { fetch: options.fetch } : {});
    this.#clock = options.clock ?? (() => new Date());
    this.#offset = options.timestampOffsetMinutes ?? DAR_ES_SALAAM_OFFSET_MINUTES;
    const make = options.signer ?? ((c: CredentialsInput) => hs256Signer(c.secret));
    const checkout = this.config.checkoutCredentials;
    const payout = this.config.payoutCredentials;
    this.#signers = { checkout: make(checkout), payout: make(payout) };
    this.#apiKeys = { checkout: checkout.apiKey, payout: payout.apiKey };
  }

  /**
   * Runs one operation: validates, signs (fresh timestamp), sends, classifies. Use it with
   * `operations.*` for anything the named methods do not cover.
   */
  async execute<Req, Data>(
    op: OperationSpec<Req, Data>,
    request: Req,
    options: CallOptions = {},
  ): Promise<OperationResult<Data>> {
    const context: BuildContext = {
      vendor: this.config.vendor,
      pin: () => this.config.requirePin(),
    };
    const params = op.buildParams(request, context);
    const timeout =
      op.kind === "payment" ? this.config.timeouts.moneyMoving : this.config.timeouts.query;
    // Only read-only operations may be repeated, and only after NOT_SENT, and only if opted in.
    const maxAttempts = op.kind !== "payment" && !op.write ? 1 + this.config.retryNotSent : 1;

    let response: TransportResponse | undefined;
    for (let attempt = 1; response === undefined; attempt++) {
      // A fresh timestamp and signature on every attempt.
      const signed = signRequest({
        method: op.method,
        params,
        timestamp: formatTimestamp(this.#clock(), this.#offset),
        apiKey: this.#apiKeys[op.credentials],
        signer: this.#signers[op.credentials],
      });
      const url = `${this.config.baseUrl}${op.path}${signed.query === undefined ? "" : `?${signed.query}`}`;
      try {
        response = await this.#transport.send({
          method: op.method,
          url,
          headers: { ...signed.headers, "User-Agent": USER_AGENT },
          ...(signed.body === undefined ? {} : { body: signed.body }),
          timeout,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (e) {
        const error = asTransportError(e);
        if (error.classification === "NOT_SENT" && attempt < maxAttempts) continue;
        throw error;
      }
    }

    const verdict = classify(op.kind, response.status, response.body);
    const envelope = verdict.body;
    const ids = op.ids(request);
    const entries = Array.isArray(envelope?.data) ? (envelope.data as unknown[]) : [];
    const data = entries
      .filter(
        (e): e is Record<string, unknown> =>
          typeof e === "object" && e !== null && !Array.isArray(e),
      )
      .map((e) => op.mapData(e))
      .filter((d) => d !== undefined) as Data[];

    return new OperationResult<Data>({
      status: verdict.status,
      resultcode: verdict.resultcode,
      result: text(envelope?.result),
      message: text(envelope?.message),
      reference: text(envelope?.reference),
      transid: text(envelope?.transid) ?? ids.transid,
      orderId: ids.orderId,
      httpStatus: response.status,
      data,
      body: envelope,
      raw: response.body,
    });
  }

  // ----- Checkout -----

  /** Creates an order payable by any enabled method, cards included. Not retried. */
  createOrder(
    request: CreateOrderRequest,
    options?: CallOptions,
  ): Promise<OperationResult<OrderCreated>> {
    return this.execute(operations.createOrder, request, options);
  }

  /** Creates an order for non-card payment (first step of a USSD push). Not retried. */
  createOrderMinimal(
    request: CreateOrderMinimalRequest,
    options?: CallOptions,
  ): Promise<OperationResult<OrderCreated>> {
    return this.execute(operations.createOrderMinimal, request, options);
  }

  /** Pushes a USSD prompt to the buyer's wallet. Money-moving: never retried. */
  walletPayment(
    request: WalletPaymentRequest,
    options?: CallOptions,
  ): Promise<OperationResult<RawData>> {
    return this.execute(operations.walletPayment, request, options);
  }

  /** Charges a stored card for an existing order. Money-moving: never retried. */
  cardPayment(
    request: CardPaymentRequest,
    options?: CallOptions,
  ): Promise<OperationResult<RawData>> {
    return this.execute(operations.cardPayment, request, options);
  }

  /** The source of truth for a checkout order. The verdict is `status`, from `payment_status`. */
  orderStatus(request: OrderIdRequest, options?: CallOptions): Promise<OperationResult<OrderInfo>> {
    return this.execute(operations.orderStatus, request, options);
  }

  /** Cancels an unpaid order. A successful cancel proves the order was never paid. Not retried. */
  cancelOrder(request: OrderIdRequest, options?: CallOptions): Promise<OperationResult<undefined>> {
    return this.execute(operations.cancelOrder, request, options);
  }

  /** Lists orders created in a date range, for reconciliation. */
  listOrders(
    request: ListOrdersRequest,
    options?: CallOptions,
  ): Promise<OperationResult<OrderSummary>> {
    return this.execute(operations.listOrders, request, options);
  }

  /** Lists the cards stored for a buyer. */
  storedCards(
    request: StoredCardsRequest,
    options?: CallOptions,
  ): Promise<OperationResult<StoredCard>> {
    return this.execute(operations.storedCards, request, options);
  }

  /** Removes a stored card. Not retried. */
  deleteCard(
    request: DeleteCardRequest,
    options?: CallOptions,
  ): Promise<OperationResult<undefined>> {
    return this.execute(operations.deleteCard, request, options);
  }

  // ----- Payouts (spend from the float account) -----

  /** Pays a bill or buys a prepaid service from the float. Money-moving: never retried. */
  utilityPayment(
    request: PayoutRequest,
    options?: CallOptions,
  ): Promise<OperationResult<PayoutData>> {
    return this.execute(operations.utilityPayment, request, options);
  }

  /** Checks a customer reference before paying. */
  utilityLookup(
    request: LookupRequest,
    options?: CallOptions,
  ): Promise<OperationResult<UtilityLookupData>> {
    return this.execute(operations.utilityLookup, request, options);
  }

  /** The verdict on an earlier `utilityPayment`, by `transid`. Query after 3 minutes or more. */
  utilityQuery(
    request: TransidRequest,
    options?: CallOptions,
  ): Promise<OperationResult<PayoutData>> {
    return this.execute(operations.utilityQuery, request, options);
  }

  /** Credits a mobile wallet from the float. Money-moving: never retried. */
  walletCashIn(
    request: PayoutRequest,
    options?: CallOptions,
  ): Promise<OperationResult<PayoutData>> {
    return this.execute(operations.walletCashIn, request, options);
  }

  /** The registered name on a wallet, before sending money to it. */
  walletNameLookup(
    request: LookupRequest,
    options?: CallOptions,
  ): Promise<OperationResult<NameLookupData>> {
    return this.execute(operations.walletNameLookup, request, options);
  }

  /** The verdict on an earlier `walletCashIn`, by `transid`. Query after 3 minutes or more. */
  walletCashInQuery(
    request: TransidRequest,
    options?: CallOptions,
  ): Promise<OperationResult<PayoutData>> {
    return this.execute(operations.walletCashInQuery, request, options);
  }

  /** The float account balance. Moves no money. */
  vendorBalance(
    request: BalanceRequest,
    options?: CallOptions,
  ): Promise<OperationResult<BalanceData>> {
    return this.execute(operations.vendorBalance, request, options);
  }
}

function asTransportError(e: unknown): TransportError {
  if (e instanceof TransportError) return e;
  if (e instanceof SelcomError) throw e;
  // A custom transport threw something else: we cannot tell whether the request left.
  return new TransportError("UNKNOWN_OUTCOME", "the transport failed without a classification", e);
}
