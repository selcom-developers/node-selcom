import { ValidationError } from "./errors.js";
import {
  classifyPaymentStatus,
  type OperationKind,
  parseAmount,
  type Status,
  text,
} from "./results.js";
import type { HttpMethod, Params } from "./signing.js";

// ---------------------------------------------------------------------------
// Operation specs: one per operation in the spec's vectors/responses/.
// ---------------------------------------------------------------------------

/** Values an operation needs from the configuration, when it builds its parameters. */
export interface BuildContext {
  vendor: string;
  /** Throws `ConfigError` when no PIN is configured. */
  pin(): string;
}

export interface OperationSpec<Req, Data> {
  /** The spec's operation name, e.g. `checkout.create-order`. */
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly kind: OperationKind;
  /** Writes (create-order, cancel-order, delete-card) are never retried, though they move no money. */
  readonly write: boolean;
  /** Which credential set signs the request. */
  readonly credentials: "checkout" | "payout";
  /** Validates the request and returns the ordered parameters to sign and send. */
  buildParams(request: Req, context: BuildContext): Params;
  /** Maps one `data` entry. Lenient: fields the gateway omits are `undefined`. */
  mapData(entry: Record<string, unknown>): Data;
  /** The IDs a result is about, taken from the request. */
  ids(request: Req): { transid?: string; orderId?: string };
}

type Entry = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${name} is required and must be a non-empty string`);
  }
  return value;
}

function optional(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return required(value, name);
}

/** Whole units: a positive safe integer. Fractions are rejected, never rounded. */
function wholeAmount(value: unknown, name = "amount"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(
      `${name} must be a positive whole number of units (no fractions, nothing above 2^53 - 1)`,
    );
  }
  return value;
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive whole number`);
  }
  return value;
}

function checkoutCurrency(value: unknown): "TZS" | "USD" {
  if (value !== "TZS" && value !== "USD") {
    throw new ValidationError('currency is required and must be "TZS" or "USD" (no default)');
  }
  return value;
}

/** Payouts are TZS only and carry no currency field; any other currency is refused. */
function payoutCurrency(value: unknown): void {
  if (value !== undefined && value !== "TZS") {
    throw new ValidationError("payout operations are TZS only");
  }
}

function dateText(value: unknown, name: string): string {
  const s = required(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`${name} must be YYYY-MM-DD`);
  return s;
}

/** Base64 of a URL, as `redirect_url`, `cancel_url` and `webhook` require. Signed in this form. */
export function encodeUrlParam(url: string, name: string): string {
  const u = required(url, name);
  return Buffer.from(u, "utf8").toString("base64");
}

/** Decodes a base64 URL from a response. Returns `undefined` when it is not valid base64 text. */
export function decodeUrlParam(value: unknown): string | undefined {
  const s = text(value);
  if (s === undefined || s === "" || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return undefined;
  const decoded = Buffer.from(s, "base64").toString("utf8");
  return decoded.includes("�") ? undefined : decoded;
}

// ---------------------------------------------------------------------------
// Request and data types
// ---------------------------------------------------------------------------

export type PaymentMethod = "ALL" | "MASTERPASS" | "CARD" | "MOBILEMONEYPULL";

export interface Address {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  stateOrRegion: string;
  postcodeOrPobox: string;
  /** ISO 3166-1 alpha-2, for example `TZ`. */
  country: string;
  phone: string;
}

export interface CreateOrderRequest {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  buyerPhone: string;
  /** The buyer's ID in your system; omit for guest checkout. Needed later for stored cards. */
  buyerUserId?: string;
  /** Returned on the buyer's first order; send it on later orders. */
  gatewayBuyerUuid?: string;
  /** Whole units of `currency`. */
  amount: number;
  /** Always explicit; there is no default. */
  currency: "TZS" | "USD";
  paymentMethods: readonly PaymentMethod[];
  /** Plain URLs; they are base64-encoded for you (and signed in that form). */
  redirectUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  /** Send the full billing group for any order that may be paid by card. */
  billing: Address;
  shipping?: Address;
  buyerRemarks?: string;
  merchantRemarks?: string;
  noOfItems: number;
  headerColour?: string;
  linkColour?: string;
  buttonColour?: string;
  /** Minutes until the order expires. */
  expiry?: number;
}

export type CreateOrderMinimalRequest = Omit<
  CreateOrderRequest,
  "paymentMethods" | "billing" | "shipping" | "buyerUserId" | "gatewayBuyerUuid"
>;

export interface OrderCreated {
  gatewayBuyerUuid: string | undefined;
  paymentToken: string | undefined;
  qr: string | undefined;
  /** Decoded from base64; `undefined` if the gateway's value is not valid base64 text. */
  paymentGatewayUrl: string | undefined;
  /** The value exactly as the gateway sent it. */
  paymentGatewayUrlRaw: string | undefined;
}

export interface WalletPaymentRequest {
  /** Your unique ID for this payment attempt. */
  transid: string;
  orderId: string;
  /** The wallet to charge, `255...`. */
  msisdn: string;
}

export interface CardPaymentRequest {
  transid: string;
  orderId: string;
  /** From `storedCards`. Sensitive: never log it in full. */
  cardToken: string;
  buyerUserId: string;
  gatewayBuyerUuid: string;
}

/** Entry `data` of a push or card payment: kept as the gateway sent it. */
export type RawData = Entry;

export interface OrderIdRequest {
  orderId: string;
}

export interface OrderInfo {
  orderId: string | undefined;
  creationDate: string | undefined;
  /** As the gateway sent it (a string, maybe with thousands separators). */
  amount: string | undefined;
  /** Whole units, or `undefined` if the gateway's text is not a whole amount. */
  amountTzs: number | undefined;
  /** The gateway's raw `payment_status`. The typed verdict is the result's `status`. */
  paymentStatus: string | undefined;
  transid: string | undefined;
  channel: string | undefined;
  reference: string | undefined;
  /** The payer's number, published as `msisdn`, seen as `phone`: either is accepted. */
  msisdn: string | undefined;
}

export interface ListOrdersRequest {
  /** `YYYY-MM-DD`. */
  fromDate: string;
  /** `YYYY-MM-DD`. */
  toDate: string;
}

export interface OrderSummary {
  orderId: string | undefined;
  creationDate: string | undefined;
  amount: string | undefined;
  amountTzs: number | undefined;
  paymentStatus: string | undefined;
  /** `payment_status` mapped as for order status. */
  status: Status;
}

export interface StoredCardsRequest {
  gatewayBuyerUuid: string;
  buyerUserId: string;
}

export interface StoredCard {
  /** The card's resource ID, used to delete it (the gateway sends a number or a string). */
  id: string | undefined;
  maskedCard: string | undefined;
  creationDate: string | undefined;
  /** Cardholder name. */
  name: string | undefined;
  /** `001` Visa, `002` Mastercard. */
  cardType: string | undefined;
  /** Used to charge the card. Sensitive: never log it in full. */
  cardToken: string | undefined;
}

export interface DeleteCardRequest {
  /** The card's resource ID from `storedCards`. */
  id: string | number;
  gatewayBuyerUuid: string;
}

export interface PayoutRequest {
  /** Your unique ID. It is also the key for the status query. */
  transid: string;
  /** Which service: `LUKU`, `TOP`, `VMCASHIN`, `CASHIN`, and so on. */
  utilityCode: string;
  /** Meter number, phone number, control number, receiving wallet and so on. */
  utilityRef: string;
  /** Whole TZS. */
  amount: number;
  /** The end customer's (or the initiator's) phone number. */
  msisdn?: string;
  /** Payouts are TZS only; any other value is refused. */
  currency?: "TZS";
}

export interface PayoutData {
  receipt: string | undefined;
  /** The entry exactly as sent, for fields this client does not name. */
  entry: Entry;
}

export interface LookupRequest {
  utilityCode: string;
  utilityRef: string;
  /** A unique ID. The same one may then be used for the payment that follows. */
  transid: string;
}

export interface UtilityLookupData {
  name: string | undefined;
  amount: string | undefined;
  institution: string | undefined;
  type: string | undefined;
  desc: string | undefined;
}

export interface NameLookupData {
  name: string | undefined;
}

export interface TransidRequest {
  transid: string;
}

export interface BalanceRequest {
  /** A unique ID. */
  transid: string;
}

export interface BalanceData {
  /** Whole shillings, as the gateway sent them. */
  balance: string | undefined;
  /** `balance` parsed strictly, or `undefined` if it is not a whole amount. */
  balanceTzs: number | undefined;
}

// ---------------------------------------------------------------------------
// Builders and mappers
// ---------------------------------------------------------------------------

function addressParams(a: Address, name: string): Map<string, string | undefined> {
  return new Map<string, string | undefined>([
    ["firstname", required(a?.firstName, `${name}.firstName`)],
    ["lastname", required(a?.lastName, `${name}.lastName`)],
    ["address_1", required(a?.address1, `${name}.address1`)],
    ["address_2", optional(a?.address2, `${name}.address2`)],
    ["city", required(a?.city, `${name}.city`)],
    ["state_or_region", required(a?.stateOrRegion, `${name}.stateOrRegion`)],
    ["postcode_or_pobox", required(a?.postcodeOrPobox, `${name}.postcodeOrPobox`)],
    ["country", required(a?.country, `${name}.country`)],
    ["phone", required(a?.phone, `${name}.phone`)],
  ]);
}

function checkoutColours(
  r: CreateOrderMinimalRequest,
): Array<[string, string | number | undefined]> {
  return [
    ["buyer_remarks", optional(r.buyerRemarks, "buyerRemarks")],
    ["merchant_remarks", optional(r.merchantRemarks, "merchantRemarks")],
    ["no_of_items", positiveInt(r.noOfItems, "noOfItems")],
    ["header_colour", optional(r.headerColour, "headerColour")],
    ["link_colour", optional(r.linkColour, "linkColour")],
    ["button_colour", optional(r.buttonColour, "buttonColour")],
    ["expiry", r.expiry === undefined ? undefined : positiveInt(r.expiry, "expiry")],
  ];
}

function urlParams(r: CreateOrderMinimalRequest): Array<[string, string | undefined]> {
  return [
    [
      "redirect_url",
      r.redirectUrl === undefined ? undefined : encodeUrlParam(r.redirectUrl, "redirectUrl"),
    ],
    [
      "cancel_url",
      r.cancelUrl === undefined ? undefined : encodeUrlParam(r.cancelUrl, "cancelUrl"),
    ],
    [
      "webhook",
      r.webhookUrl === undefined ? undefined : encodeUrlParam(r.webhookUrl, "webhookUrl"),
    ],
  ];
}

function mapOrderCreated(e: Entry): OrderCreated {
  return {
    gatewayBuyerUuid: text(e.gateway_buyer_uuid),
    paymentToken: text(e.payment_token),
    qr: text(e.qr),
    paymentGatewayUrl: decodeUrlParam(e.payment_gateway_url),
    paymentGatewayUrlRaw: text(e.payment_gateway_url),
  };
}

function amountOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    return parseAmount(value);
  } catch {
    return undefined;
  }
}

function mapOrderInfo(e: Entry): OrderInfo {
  const amount = text(e.amount);
  return {
    orderId: text(e.order_id),
    creationDate: text(e.creation_date),
    amount,
    amountTzs: amountOrUndefined(amount),
    paymentStatus: text(e.payment_status),
    transid: text(e.transid),
    channel: text(e.channel),
    reference: text(e.reference),
    msisdn: text(e.msisdn) ?? text(e.phone),
  };
}

const raw = (e: Entry): Entry => e;
const none = (): undefined => undefined;

function payoutParams(r: PayoutRequest, c: BuildContext): Params {
  payoutCurrency(r.currency);
  return new Map<string, string | number | undefined>([
    ["transid", required(r.transid, "transid")],
    ["utilitycode", required(r.utilityCode, "utilityCode")],
    ["utilityref", required(r.utilityRef, "utilityRef")],
    ["amount", wholeAmount(r.amount)],
    ["vendor", c.vendor],
    ["pin", c.pin()],
    ["msisdn", optional(r.msisdn, "msisdn")],
  ]);
}

const mapPayout = (e: Entry): PayoutData => ({ receipt: text(e.receipt), entry: e });
const byTransid = (r: { transid: string }) => ({ transid: r.transid });
const byOrder = (r: { orderId: string }) => ({ orderId: r.orderId });

/** Every v1 operation. Use with `client.execute(operations.orderStatus, request)`. */
export const operations = {
  createOrder: {
    name: "checkout.create-order",
    method: "POST",
    path: "/v1/checkout/create-order",
    kind: "other",
    write: true,
    credentials: "checkout",
    buildParams(r: CreateOrderRequest, c) {
      if (!Array.isArray(r.paymentMethods) || r.paymentMethods.length === 0) {
        throw new ValidationError(
          "paymentMethods needs at least one of ALL, MASTERPASS, CARD, MOBILEMONEYPULL",
        );
      }
      return new Map<string, unknown>([
        ["vendor", c.vendor],
        ["order_id", required(r.orderId, "orderId")],
        ["buyer_email", required(r.buyerEmail, "buyerEmail")],
        ["buyer_name", required(r.buyerName, "buyerName")],
        ["buyer_userid", optional(r.buyerUserId, "buyerUserId")],
        ["buyer_phone", required(r.buyerPhone, "buyerPhone")],
        ["gateway_buyer_uuid", optional(r.gatewayBuyerUuid, "gatewayBuyerUuid")],
        ["amount", wholeAmount(r.amount)],
        ["currency", checkoutCurrency(r.currency)],
        ["payment_methods", r.paymentMethods.join(",")],
        ...urlParams(r),
        ["billing", addressParams(r.billing, "billing")],
        ["shipping", r.shipping === undefined ? undefined : addressParams(r.shipping, "shipping")],
        ...checkoutColours(r),
      ]) as Params;
    },
    mapData: mapOrderCreated,
    ids: byOrder,
  } satisfies OperationSpec<CreateOrderRequest, OrderCreated>,

  createOrderMinimal: {
    name: "checkout.create-order-minimal",
    method: "POST",
    path: "/v1/checkout/create-order-minimal",
    kind: "other",
    write: true,
    credentials: "checkout",
    buildParams(r: CreateOrderMinimalRequest, c) {
      return new Map<string, unknown>([
        ["vendor", c.vendor],
        ["order_id", required(r.orderId, "orderId")],
        ["buyer_email", required(r.buyerEmail, "buyerEmail")],
        ["buyer_name", required(r.buyerName, "buyerName")],
        ["buyer_phone", required(r.buyerPhone, "buyerPhone")],
        ["amount", wholeAmount(r.amount)],
        ["currency", checkoutCurrency(r.currency)],
        ...urlParams(r),
        ...checkoutColours(r),
      ]) as Params;
    },
    mapData: mapOrderCreated,
    ids: byOrder,
  } satisfies OperationSpec<CreateOrderMinimalRequest, OrderCreated>,

  walletPayment: {
    name: "checkout.wallet-payment",
    method: "POST",
    path: "/v1/checkout/wallet-payment",
    kind: "payment",
    write: false,
    credentials: "checkout",
    buildParams: (r: WalletPaymentRequest) =>
      new Map([
        ["transid", required(r.transid, "transid")],
        ["order_id", required(r.orderId, "orderId")],
        ["msisdn", required(r.msisdn, "msisdn")],
      ]),
    mapData: raw,
    ids: (r: WalletPaymentRequest) => ({ transid: r.transid, orderId: r.orderId }),
  } satisfies OperationSpec<WalletPaymentRequest, RawData>,

  cardPayment: {
    name: "checkout.card-payment",
    method: "POST",
    path: "/v1/checkout/card-payment",
    kind: "payment",
    write: false,
    credentials: "checkout",
    buildParams: (r: CardPaymentRequest, c) =>
      new Map([
        ["transid", required(r.transid, "transid")],
        ["vendor", c.vendor],
        ["order_id", required(r.orderId, "orderId")],
        ["card_token", required(r.cardToken, "cardToken")],
        ["buyer_userid", required(r.buyerUserId, "buyerUserId")],
        ["gateway_buyer_uuid", required(r.gatewayBuyerUuid, "gatewayBuyerUuid")],
      ]),
    mapData: raw,
    ids: (r: CardPaymentRequest) => ({ transid: r.transid, orderId: r.orderId }),
  } satisfies OperationSpec<CardPaymentRequest, RawData>,

  orderStatus: {
    name: "checkout.order-status",
    method: "GET",
    path: "/v1/checkout/order-status",
    kind: "order-status",
    write: false,
    credentials: "checkout",
    buildParams: (r: OrderIdRequest) => new Map([["order_id", required(r.orderId, "orderId")]]),
    mapData: mapOrderInfo,
    ids: byOrder,
  } satisfies OperationSpec<OrderIdRequest, OrderInfo>,

  cancelOrder: {
    name: "checkout.cancel-order",
    method: "DELETE",
    path: "/v1/checkout/cancel-order",
    kind: "other",
    write: true,
    credentials: "checkout",
    buildParams: (r: OrderIdRequest) => new Map([["order_id", required(r.orderId, "orderId")]]),
    mapData: none,
    ids: byOrder,
  } satisfies OperationSpec<OrderIdRequest, undefined>,

  listOrders: {
    name: "checkout.list-orders",
    method: "GET",
    path: "/v1/checkout/list-orders",
    kind: "other",
    write: false,
    credentials: "checkout",
    buildParams: (r: ListOrdersRequest) =>
      new Map([
        ["fromdate", dateText(r.fromDate, "fromDate")],
        ["todate", dateText(r.toDate, "toDate")],
      ]),
    mapData(e: Entry): OrderSummary {
      const amount = text(e.amount);
      return {
        orderId: text(e.order_id),
        creationDate: text(e.creation_date),
        amount,
        amountTzs: amountOrUndefined(amount),
        paymentStatus: text(e.payment_status),
        status: classifyPaymentStatus(e.payment_status),
      };
    },
    ids: () => ({}),
  } satisfies OperationSpec<ListOrdersRequest, OrderSummary>,

  storedCards: {
    name: "checkout.stored-cards",
    method: "GET",
    path: "/v1/checkout/stored-cards",
    kind: "other",
    write: false,
    credentials: "checkout",
    buildParams: (r: StoredCardsRequest) =>
      new Map([
        ["gateway_buyer_uuid", required(r.gatewayBuyerUuid, "gatewayBuyerUuid")],
        ["buyer_userid", required(r.buyerUserId, "buyerUserId")],
      ]),
    mapData: (e: Entry): StoredCard => ({
      id: text(e.id),
      maskedCard: text(e.masked_card),
      creationDate: text(e.creation_date),
      name: text(e.name),
      cardType: text(e.card_type),
      cardToken: text(e.card_token),
    }),
    ids: () => ({}),
  } satisfies OperationSpec<StoredCardsRequest, StoredCard>,

  deleteCard: {
    name: "checkout.delete-card",
    method: "DELETE",
    path: "/v1/checkout/delete-card",
    kind: "other",
    write: true,
    credentials: "checkout",
    buildParams: (r: DeleteCardRequest) =>
      new Map([
        ["id", required(String(r.id ?? ""), "id")],
        ["gateway_buyer_uuid", required(r.gatewayBuyerUuid, "gatewayBuyerUuid")],
      ]),
    mapData: none,
    ids: () => ({}),
  } satisfies OperationSpec<DeleteCardRequest, undefined>,

  utilityPayment: {
    name: "utilitypayment.process",
    method: "POST",
    path: "/v1/utilitypayment/process",
    kind: "payment",
    write: false,
    credentials: "payout",
    buildParams: payoutParams,
    mapData: mapPayout,
    ids: byTransid,
  } satisfies OperationSpec<PayoutRequest, PayoutData>,

  utilityLookup: {
    name: "utilitypayment.lookup",
    method: "GET",
    path: "/v1/utilitypayment/lookup",
    kind: "other",
    write: false,
    credentials: "payout",
    buildParams: (r: LookupRequest) =>
      new Map([
        ["utilitycode", required(r.utilityCode, "utilityCode")],
        ["utilityref", required(r.utilityRef, "utilityRef")],
        ["transid", required(r.transid, "transid")],
      ]),
    mapData: (e: Entry): UtilityLookupData => ({
      name: text(e.name),
      amount: text(e.amount),
      institution: text(e.institution),
      type: text(e.type),
      desc: text(e.desc),
    }),
    ids: byTransid,
  } satisfies OperationSpec<LookupRequest, UtilityLookupData>,

  utilityQuery: {
    name: "utilitypayment.query",
    method: "GET",
    path: "/v1/utilitypayment/query",
    kind: "status-query",
    write: false,
    credentials: "payout",
    buildParams: (r: TransidRequest) => new Map([["transid", required(r.transid, "transid")]]),
    mapData: mapPayout,
    ids: byTransid,
  } satisfies OperationSpec<TransidRequest, PayoutData>,

  walletCashIn: {
    name: "walletcashin.process",
    method: "POST",
    path: "/v1/walletcashin/process",
    kind: "payment",
    write: false,
    credentials: "payout",
    buildParams: payoutParams,
    mapData: mapPayout,
    ids: byTransid,
  } satisfies OperationSpec<PayoutRequest, PayoutData>,

  walletNameLookup: {
    name: "walletcashin.namelookup",
    method: "GET",
    path: "/v1/walletcashin/namelookup",
    kind: "other",
    write: false,
    credentials: "payout",
    buildParams: (r: LookupRequest) =>
      new Map([
        ["utilitycode", required(r.utilityCode, "utilityCode")],
        ["utilityref", required(r.utilityRef, "utilityRef")],
        ["transid", required(r.transid, "transid")],
      ]),
    mapData: (e: Entry): NameLookupData => ({ name: text(e.name) }),
    ids: byTransid,
  } satisfies OperationSpec<LookupRequest, NameLookupData>,

  walletCashInQuery: {
    name: "walletcashin.query",
    method: "GET",
    path: "/v1/walletcashin/query",
    kind: "status-query",
    write: false,
    credentials: "payout",
    buildParams: (r: TransidRequest) => new Map([["transid", required(r.transid, "transid")]]),
    mapData: mapPayout,
    ids: byTransid,
  } satisfies OperationSpec<TransidRequest, PayoutData>,

  vendorBalance: {
    name: "vendor.balance",
    method: "POST",
    path: "/v1/vendor/balance",
    kind: "other",
    write: false,
    credentials: "payout",
    buildParams: (r: BalanceRequest, c) =>
      new Map([
        ["vendor", c.vendor],
        ["pin", c.pin()],
        ["transid", required(r.transid, "transid")],
      ]),
    mapData(e: Entry): BalanceData {
      const balance = text(e.balance);
      return { balance, balanceTzs: amountOrUndefined(balance) };
    },
    ids: byTransid,
  } satisfies OperationSpec<BalanceRequest, BalanceData>,
};
