/** Base class of every error this package throws on purpose. */
export class SelcomError extends Error {
  /** Stable machine-readable code. */
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Bad or missing configuration. Raised at construction (or, for the float PIN, at the first payout call). */
export class ConfigError extends SelcomError {
  constructor(message: string) {
    super("CONFIG", message);
  }
}

/** A request failed local validation. Nothing was signed and nothing was sent. */
export class ValidationError extends SelcomError {
  constructor(message: string) {
    super("VALIDATION", message);
  }
}

/**
 * The signer refused its input. Nothing is ever sent after this error.
 * Codes match the `error` field of the `rejects` in the spec's signing vectors.
 */
export type SigningErrorCode =
  | "EMPTY_SECRET"
  | "EMPTY_API_KEY"
  | "EMPTY_PARAMS"
  | "NON_INTEGER_NUMBER"
  | "NUMBER_OUT_OF_RANGE"
  | "UNSUPPORTED_TYPE"
  | "INVALID_KEY"
  | "DUPLICATE_KEY"
  | "EMPTY_OBJECT"
  | "INVALID_TIMESTAMP"
  | "INVALID_VALUE"
  | "EMPTY_DIGEST"
  | "INVALID_METHOD";

export class SigningError extends SelcomError {
  declare readonly code: SigningErrorCode;

  constructor(code: SigningErrorCode, message: string) {
    super(code, message);
  }
}

/**
 * - `NOT_SENT`: the request provably never reached the gateway. Sending again with the same ID is safe.
 * - `UNKNOWN_OUTCOME`: the gateway may have acted. Treat as `AMBIGUOUS`: query, never resend.
 */
export type TransportClassification = "NOT_SENT" | "UNKNOWN_OUTCOME";

/** No HTTP response was received. Never disguised as a gateway response or as `FAILED`. */
export class TransportError extends SelcomError {
  readonly classification: TransportClassification;

  constructor(classification: TransportClassification, message: string, cause?: unknown) {
    super(`TRANSPORT_${classification}`, message, { cause });
    this.classification = classification;
  }

  get notSent(): boolean {
    return this.classification === "NOT_SENT";
  }
}

/** A response arrived but carries no verdict, for an operation where that is an error (not money-moving). */
export class InvalidResponseError extends SelcomError {
  readonly httpStatus: number;
  /** The raw body, for audit. Redact before logging. */
  declare readonly raw: string;

  constructor(message: string, httpStatus: number, raw: string) {
    super("INVALID_RESPONSE", message);
    this.httpStatus = httpStatus;
    // Non-enumerable so default error logging does not print the body.
    Object.defineProperty(this, "raw", { value: raw, enumerable: false });
  }
}

/** An amount string from the gateway is not a whole number of units. */
export class AmountError extends SelcomError {
  constructor(message: string) {
    super("INVALID_AMOUNT", message);
  }
}

/** A webhook body could not be parsed. */
export class WebhookParseError extends SelcomError {
  constructor(message: string) {
    super("WEBHOOK_PARSE", message);
  }
}

/**
 * The replay store failed (threw or rejected), so the delivery could not be checked. Answer with a
 * 5xx so the gateway delivers again; do not treat it as a bad delivery.
 */
export class ReplayStoreError extends SelcomError {
  constructor(cause?: unknown) {
    super("REPLAY_STORE", "the replay store failed; answer with a 5xx so the delivery is retried", {
      cause,
    });
  }
}
