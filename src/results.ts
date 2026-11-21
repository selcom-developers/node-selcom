import { AmountError, InvalidResponseError } from "./errors.js";
import { type RedactOptions, redactBody, redactBodyText } from "./redact.js";

/**
 * The five typed statuses every operation returns, spelled exactly like this.
 *
 * - `SUCCESS`: it happened (final).
 * - `PENDING`: accepted, still processing. Wait for the webhook or query after 3 minutes or more.
 * - `AMBIGUOUS`: nobody knows yet. Query after 3 minutes or more. Never resubmit.
 * - `FAILED`: it did not happen (final). A new attempt is a new transaction with a new ID.
 * - `NOT_FOUND`: the gateway has no record of the ID. The only case where the same ID may be submitted again.
 */
export type Status = "SUCCESS" | "PENDING" | "AMBIGUOUS" | "FAILED" | "NOT_FOUND";

/** Decides classification, timeout profile and retry rules. See the spec's api-v1.md. */
export type OperationKind = "payment" | "status-query" | "order-status" | "other";

export function isFinalStatus(status: Status): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "NOT_FOUND";
}

export interface Classification {
  status: Status;
  /** Normalised result code, absent when the response carried no verdict. */
  resultcode?: string;
  /** The parsed response envelope, when the body was a JSON object. */
  body?: Record<string, unknown>;
}

/**
 * Normalises `resultcode`: a trimmed non-empty string, or a JSON number formatted as three digits
 * (`0` becomes `000`). Anything else is "no usable code".
 */
export function normalizeResultCode(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? undefined : t;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value).padStart(3, "0");
  }
  return undefined;
}

/** Maps `data[0].payment_status` (order status, list-orders, webhooks) to a status. */
export function classifyPaymentStatus(paymentStatus: unknown): Status {
  if (typeof paymentStatus !== "string") return "AMBIGUOUS";
  switch (paymentStatus.trim().toUpperCase()) {
    case "COMPLETED":
    case "COMPLETE":
      return "SUCCESS";
    case "PENDING":
    case "INPROGRESS":
      return "PENDING";
    case "CANCELLED":
    case "CANCELED":
    case "CANCEL":
    case "USERCANCELLED":
    case "USERCANCELED":
    case "REJECTED":
    case "FAILED":
      return "FAILED";
    default:
      return "AMBIGUOUS";
  }
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return undefined;
}

/**
 * Turns a response into a status, as the spec's results.md says. Classifies by `resultcode` only:
 * the `result` text and the HTTP status never decide the verdict.
 *
 * Throws `InvalidResponseError` when there is no verdict and the kind is `other`.
 */
export function classify(kind: OperationKind, httpStatus: number, raw: string): Classification {
  const body = parseObject(raw);
  const resultcode = body ? normalizeResultCode(body.resultcode) : undefined;

  // 1. No verdict.
  if (body === undefined || resultcode === undefined) {
    if (kind === "other") {
      throw new InvalidResponseError(
        `the gateway response has no usable resultcode (HTTP ${httpStatus})`,
        httpStatus,
        raw,
      );
    }
    return { status: "AMBIGUOUS", ...(body ? { body } : {}) };
  }

  const done = (status: Status): Classification => ({ status, resultcode, body });

  // 2. 000. For order-status the verdict is data[0].payment_status.
  if (resultcode === "000") {
    if (kind === "order-status") return done(classifyOrderData(body.data));
    return done("SUCCESS");
  }
  // 3. 111 or 927.
  if (resultcode === "111" || resultcode === "927") return done("PENDING");
  // 4. 999.
  if (resultcode === "999") return done("AMBIGUOUS");
  // 5. 404 on a status query.
  if (resultcode === "404" && (kind === "status-query" || kind === "order-status")) {
    return done("NOT_FOUND");
  }
  // 6. Anything else.
  return done(kind === "order-status" ? "AMBIGUOUS" : "FAILED");
}

function classifyOrderData(data: unknown): Status {
  if (!Array.isArray(data)) return "AMBIGUOUS";
  if (data.length === 0) return "NOT_FOUND";
  const first = data[0] as unknown;
  if (typeof first !== "object" || first === null) return "AMBIGUOUS";
  return classifyPaymentStatus((first as Record<string, unknown>).payment_status);
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** What an operation returns. Plain data plus `isFinal()`; the raw body is kept for audit. */
export class OperationResult<T> {
  readonly status: Status;
  /** Normalised result code; `undefined` when the response carried no verdict. */
  readonly resultcode: string | undefined;
  /** The gateway's text, unchanged. */
  readonly result: string | undefined;
  readonly message: string | undefined;
  readonly reference: string | undefined;
  /** The payment or payout ID this result is about. */
  readonly transid: string | undefined;
  /** The checkout order ID this result is about. */
  readonly orderId: string | undefined;
  readonly httpStatus: number;
  /** The decoded `data` entries (base64 URLs decoded where the operation defines them). */
  declare readonly data: readonly T[];
  /** The parsed response envelope with every raw value, when the body was a JSON object. */
  declare readonly body: Record<string, unknown> | undefined;
  /** The raw response body, for audit. Redact before logging (`toJSON` and `redacted()` do). */
  declare readonly raw: string;

  constructor(fields: {
    status: Status;
    resultcode: string | undefined;
    result: string | undefined;
    message: string | undefined;
    reference: string | undefined;
    transid: string | undefined;
    orderId: string | undefined;
    httpStatus: number;
    data: readonly T[];
    body: Record<string, unknown> | undefined;
    raw: string;
  }) {
    this.status = fields.status;
    this.resultcode = fields.resultcode;
    this.result = fields.result;
    this.message = fields.message;
    this.reference = fields.reference;
    this.transid = fields.transid;
    this.orderId = fields.orderId;
    this.httpStatus = fields.httpStatus;
    // Non-enumerable: console.log and default serialisers never print card tokens, names or phones.
    Object.defineProperty(this, "data", { value: fields.data, enumerable: false });
    Object.defineProperty(this, "body", { value: fields.body, enumerable: false });
    Object.defineProperty(this, "raw", { value: fields.raw, enumerable: false });
  }

  /** `console.log(result)` and `util.inspect` show the redacted form only. */
  [INSPECT](): Record<string, unknown> {
    return this.redacted();
  }

  /** True for `SUCCESS`, `FAILED` and `NOT_FOUND`. */
  isFinal(): boolean {
    return isFinalStatus(this.status);
  }

  /** A log-safe copy: personal data and secrets in `raw`, `body` and `data` are masked. */
  redacted(options?: RedactOptions): Record<string, unknown> {
    return {
      status: this.status,
      resultcode: this.resultcode,
      result: this.result,
      message: this.message,
      reference: this.reference,
      transid: this.transid,
      orderId: this.orderId,
      httpStatus: this.httpStatus,
      data: redactBody(this.data, options),
      raw: redactBodyText(this.raw, options),
    };
  }

  toJSON(): Record<string, unknown> {
    return this.redacted();
  }
}

/** Reads a field as text (numbers become their digits). */
export function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Parses an amount from the gateway ("10000" or "10,000") strictly into whole units.
 * Anything else (decimals, signs, spaces, bad separators, beyond 2^53 - 1) throws `AmountError`.
 */
export function parseAmount(value: string | number): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new AmountError("amount is not a whole non-negative number within the safe range");
  }
  const t = value.trim();
  // Trailing zero decimals ("10000.00") are the same whole amount; any other fraction is not.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.0+)?$/.test(t)) {
    throw new AmountError("amount must be whole units, optionally with thousands separators");
  }
  const n = Number((t.split(".")[0] as string).replaceAll(",", ""));
  if (!Number.isSafeInteger(n)) throw new AmountError("amount is beyond the safe integer range");
  return n;
}
