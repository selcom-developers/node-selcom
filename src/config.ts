import { ConfigError } from "./errors.js";

export type Environment = "sandbox" | "production" | "custom";

/** Base URLs from the spec. */
export const BASE_URLS = Object.freeze({
  production: "https://apigw.selcommobile.com",
  sandbox: "https://apigwtest.selcommobile.com",
} as const);

export interface Timeout {
  /** Milliseconds to establish the connection. */
  connectMs: number;
  /** Milliseconds to wait for the response (headers, then body). */
  readMs: number;
}

export interface Timeouts {
  /** Used by `status-query`, `order-status` and `other` operations. Default 10 s / 10 s. */
  query: Timeout;
  /**
   * Used by `payment` operations. Default 15 s / 180 s. The long read timeout is deliberate:
   * timing out early does not stop the payment, it only turns a known answer into an unknown one.
   */
  moneyMoving: Timeout;
}

export const DEFAULT_TIMEOUTS: Readonly<Timeouts> = Object.freeze({
  query: Object.freeze({ connectMs: 10_000, readMs: 10_000 }),
  moneyMoving: Object.freeze({ connectMs: 15_000, readMs: 180_000 }),
});

export interface CredentialsInput {
  apiKey: string;
  secret: string;
}

export interface SelcomConfigInput {
  /**
   * Required, no default. `custom` needs `baseUrl` (a simulator or a proxy); a preset must not
   * come with one.
   */
  environment: Environment;
  baseUrl?: string;
  apiKey: string;
  secret: string;
  /** Merchant till or float-account ID issued by Selcom. */
  vendor: string;
  /** Float PIN. Needed only by payout operations; checked when one is called. */
  pin?: string;
  /** A separate credential set for `checkout.*` operations, when the merchant has one. */
  checkout?: CredentialsInput;
  timeouts?: { query?: Partial<Timeout>; moneyMoving?: Partial<Timeout> };
  /**
   * Opt-in: how many extra attempts after a `NOT_SENT` transport error, for read-only operations
   * only (never payments or writes). Each attempt gets a fresh timestamp. Default 0.
   */
  retryNotSent?: number;
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** Immutable, validated configuration. Secrets stay out of `inspect`, `JSON.stringify` and errors. */
export class SelcomConfig {
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly vendor: string;
  readonly timeouts: Readonly<Timeouts>;
  readonly retryNotSent: number;

  readonly #apiKey: string;
  readonly #secret: string;
  readonly #pin: string | undefined;
  readonly #checkout: CredentialsInput | undefined;

  constructor(input: SelcomConfigInput) {
    if (input === null || typeof input !== "object") {
      throw new ConfigError("configuration is required");
    }
    const env = input.environment as unknown;
    if (env === undefined || env === null || env === "") {
      throw new ConfigError(
        'environment is required: choose "sandbox" or "production" explicitly (there is no default)',
      );
    }
    if (env !== "sandbox" && env !== "production" && env !== "custom") {
      throw new ConfigError('environment must be "sandbox", "production" or "custom"');
    }
    this.environment = env;
    if (env === "custom") {
      if (!input.baseUrl) throw new ConfigError('environment "custom" requires baseUrl');
      this.baseUrl = validateBaseUrl(input.baseUrl);
    } else {
      if (input.baseUrl !== undefined) {
        throw new ConfigError(
          `baseUrl cannot be combined with the "${env}" preset; use environment "custom" to choose your own URL`,
        );
      }
      this.baseUrl = BASE_URLS[env];
    }

    this.#apiKey = requireText(input.apiKey, "apiKey");
    this.#secret = requireText(input.secret, "secret");
    this.vendor = requireText(input.vendor, "vendor");
    this.#pin = input.pin === undefined ? undefined : requireText(input.pin, "pin");
    if (input.checkout !== undefined) {
      this.#checkout = Object.freeze({
        apiKey: requireText(input.checkout.apiKey, "checkout.apiKey"),
        secret: requireText(input.checkout.secret, "checkout.secret"),
      });
    }

    this.timeouts = Object.freeze({
      query: mergeTimeout(DEFAULT_TIMEOUTS.query, input.timeouts?.query, "timeouts.query"),
      moneyMoving: mergeTimeout(
        DEFAULT_TIMEOUTS.moneyMoving,
        input.timeouts?.moneyMoving,
        "timeouts.moneyMoving",
      ),
    });

    const retry = input.retryNotSent ?? 0;
    if (!Number.isInteger(retry) || retry < 0 || retry > 5) {
      throw new ConfigError("retryNotSent must be an integer from 0 to 5");
    }
    this.retryNotSent = retry;
    Object.freeze(this);
  }

  /** Credentials for payout, lookup and balance operations. */
  get payoutCredentials(): CredentialsInput {
    return { apiKey: this.#apiKey, secret: this.#secret };
  }

  /** Credentials for `checkout.*`: the separate set if one was given, otherwise the main one. */
  get checkoutCredentials(): CredentialsInput {
    return this.#checkout ? { ...this.#checkout } : this.payoutCredentials;
  }

  /** The float PIN, or throws {@link ConfigError} if none was configured. */
  requirePin(): string {
    if (this.#pin === undefined) {
      throw new ConfigError("this operation needs the float PIN: set `pin` in the configuration");
    }
    return this.#pin;
  }

  toJSON(): Record<string, unknown> {
    return {
      environment: this.environment,
      baseUrl: this.baseUrl,
      vendor: this.vendor,
      timeouts: this.timeouts,
      retryNotSent: this.retryNotSent,
      apiKey: maskKey(this.#apiKey),
      ...(this.#checkout ? { checkoutApiKey: maskKey(this.#checkout.apiKey) } : {}),
      secret: "[REDACTED]",
      pin: this.#pin === undefined ? undefined : "[REDACTED]",
    };
  }

  toString(): string {
    return `SelcomConfig(${this.environment}, ${this.baseUrl}, vendor=${this.vendor}, apiKey=${maskKey(this.#apiKey)})`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

/** Convenience for `new SelcomConfig(input)`. */
export function createConfig(input: SelcomConfigInput): SelcomConfig {
  return new SelcomConfig(input);
}

/** The API key reduced to its last 4 characters. */
export function maskKey(key: string): string {
  return key.length <= 4 ? "****" : `****${key.slice(-4)}`;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${name} is required and must not be empty`);
  }
  return value;
}

function mergeTimeout(
  base: Timeout,
  override: Partial<Timeout> | undefined,
  name: string,
): Timeout {
  const connectMs = override?.connectMs ?? base.connectMs;
  const readMs = override?.readMs ?? base.readMs;
  for (const [field, v] of [
    ["connectMs", connectMs],
    ["readMs", readMs],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new ConfigError(`${name}.${field} must be a positive number of milliseconds`);
    }
  }
  return Object.freeze({ connectMs, readMs });
}

function validateBaseUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError("baseUrl is not a valid URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConfigError("baseUrl must use https (http is allowed only for localhost simulators)");
  }
  if (url.username || url.password) {
    throw new ConfigError("baseUrl must not contain credentials");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
