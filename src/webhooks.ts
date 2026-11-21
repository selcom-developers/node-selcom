import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError, ReplayStoreError, SigningError, WebhookParseError } from "./errors.js";
import {
  classifyPaymentStatus,
  normalizeResultCode,
  parseAmount,
  type Status,
  text,
} from "./results.js";
import { normalizeValue, signedText } from "./signing.js";
import { type Clock, parseTimestamp } from "./timestamp.js";

/**
 * The verification verdicts from the spec's webhooks.md:
 *
 * | Verdict    | Respond | Process? |
 * |------------|---------|----------|
 * | `VALID`    | 200     | yes, then confirm with order-status |
 * | `UNSIGNED` | 200     | yes, then confirm with order-status |
 * | `REPLAY`   | 200     | no: it has been handled |
 * | `INVALID`  | 401     | no |
 * | `STALE`    | 401     | no |
 */
export type WebhookVerdict = "VALID" | "UNSIGNED" | "REPLAY" | "INVALID" | "STALE";

/** Header names are matched case-insensitively. A `Headers`, a `Map` or a plain object will do. */
export type HeaderBag =
  | Headers
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Remembers digests until `expiresAtMs`, which is max(now, signed timestamp) + window: a delivery
 * stamped in the future stays replayable until its own timestamp goes stale. `seen` returns `true`
 * if the digest was already recorded; otherwise it records it and returns `false`. A cache with a time-to-live is enough:
 * the merchant's deduplication on `(order_id, transid)` is the durable guard.
 */
export interface ReplayStore {
  seen(digest: string, nowMs: number, expiresAtMs: number): boolean | Promise<boolean>;
}

/** In-process replay store. Use your own (Redis, a database) when you run more than one instance. */
export class MemoryReplayStore implements ReplayStore {
  readonly #expiry = new Map<string, number>();

  seen(digest: string, nowMs: number, expiresAtMs: number): boolean {
    for (const [d, until] of this.#expiry) if (until <= nowMs) this.#expiry.delete(d);
    if (this.#expiry.has(digest)) return true;
    this.#expiry.set(digest, expiresAtMs);
    return false;
  }
}

export interface WebhookVerifierOptions {
  /** The secret that signs webhooks. The spec assumes the merchant's API secret: see its open questions. */
  secret: string;
  clock?: Clock;
  /** Either side of now, in seconds. Default 300. */
  windowSeconds?: number;
  replayStore?: ReplayStore;
}

export interface WebhookVerifier {
  /**
   * Verifies one delivery. Pass the raw body exactly as received, as a string or a Buffer, before
   * any framework parses or rewrites it. Resolves with a verdict and never throws for bad input. The one exception is `ReplayStoreError`,
   * raised when the replay store itself fails: answer with a 5xx so the delivery is retried.
   */
  verify(headers: HeaderBag, rawBody: string | Uint8Array): Promise<WebhookVerdict>;
}

/** Largest webhook body that is verified; bigger ones are INVALID before any parsing or hashing. */
const MAX_BODY = 1 << 20;

/** Builds a verifier configured with the secret, a clock, a window and a replay store. */
export function createWebhookVerifier(options: WebhookVerifierOptions): WebhookVerifier {
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new ConfigError("webhook verification needs a non-empty secret");
  }
  const windowSeconds = options.windowSeconds ?? 300;
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0) {
    throw new ConfigError("windowSeconds must be a non-negative number");
  }
  const key = Buffer.from(options.secret, "utf8");
  const clock = options.clock ?? (() => new Date());
  const store = options.replayStore ?? new MemoryReplayStore();

  return {
    async verify(headers, rawBody) {
      try {
        return await check(headers, rawBody);
      } catch (e) {
        // A failing replay store is the merchant's 5xx, not a bad delivery.
        if (e instanceof ReplayStoreError) throw e;
        // Otherwise verification never throws: any unexpected input is INVALID.
        return "INVALID";
      }
    },
  };

  async function check(headers: HeaderBag, rawBody: string | Uint8Array): Promise<WebhookVerdict> {
    {
      if (rawBody.length > MAX_BODY) return "INVALID";
      // 1. No Digest header: nothing to check.
      const digest = readHeader(headers, "Digest");
      if (digest === undefined) return "UNSIGNED";
      // 2. Present but empty, or a method this client is not configured for.
      if (digest === "" || readHeader(headers, "Digest-Method") !== "HS256") return "INVALID";

      // 3. Timestamp format, JSON object body, non-empty Signed-Fields.
      const timestamp = readHeader(headers, "Timestamp") ?? "";
      const signedFields = readHeader(headers, "Signed-Fields") ?? "";
      const timestampMs = parseTimestamp(timestamp);
      if (timestampMs === undefined || signedFields === "") return "INVALID";
      const body = parseJsonObject(rawBody);
      if (body === undefined) return "INVALID";

      // Spec 0.2.1 steps 4-6, all before any hashing and all cheap.
      const names = signedFields.split(",");
      if (!names.includes("order_id") || !names.includes("transid")) return "INVALID";
      const textBody = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
      const exponentNumbers = hasExponentNumber(textBody);
      let signingString = `timestamp=${timestamp}`;
      for (const name of names) {
        if (name.includes("&")) return "INVALID";
        const found = lookup(body, name);
        if (!found.found) return "INVALID";
        // A number written with an exponent is decided without expanding it.
        if (typeof found.value === "number" && exponentNumbers) return "INVALID";
        let valueText: string;
        try {
          valueText = signedText(normalizeValue(found.value, name));
        } catch (e) {
          if (e instanceof SigningError) return "INVALID";
          throw e;
        }
        if (valueText.includes("&")) return "INVALID";
        signingString += `&${name}=${valueText}`;
      }

      // 7. Constant-time comparison.
      const expected = createHmac("sha256", key).update(signingString, "utf8").digest("base64");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(digest, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return "INVALID";

      // 8. Window, either direction.
      const nowMs = clock().getTime();
      if (Math.abs(nowMs - timestampMs) > windowSeconds * 1000) return "STALE";

      // 9. Replay.
      let replayed: boolean;
      try {
        replayed = await store.seen(
          digest,
          nowMs,
          Math.max(nowMs, timestampMs) + windowSeconds * 1000,
        );
      } catch (e) {
        throw new ReplayStoreError(e);
      }
      if (replayed) return "REPLAY";
      return "VALID";
    }
  }
}

/** What to answer, and whether to process, for a verdict. */
export function webhookResponse(verdict: WebhookVerdict): {
  httpStatus: 200 | 401;
  process: boolean;
} {
  switch (verdict) {
    case "VALID":
    case "UNSIGNED":
      return { httpStatus: 200, process: true };
    case "REPLAY":
      return { httpStatus: 200, process: false };
    default:
      return { httpStatus: 401, process: false };
  }
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  const wanted = name.toLowerCase();
  let value: string | readonly string[] | null | undefined;
  if (typeof (headers as Headers).get === "function" && !(headers instanceof Map)) {
    value = (headers as Headers).get(name);
  } else if (headers instanceof Map) {
    for (const [k, v] of headers) if (String(k).toLowerCase() === wanted) value = v;
  } else {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === wanted) value = v as string | readonly string[] | undefined;
    }
  }
  if (value === undefined || value === null) return undefined;
  // A repeated header is not something a real delivery sends: treat it as an empty (invalid) value.
  if (typeof value !== "string") return value.length === 1 ? (value[0] ?? "").trim() : "";
  return value.trim();
}

function parseJsonObject(rawBody: string | Uint8Array): Record<string, unknown> | undefined {
  try {
    const textBody =
      typeof rawBody === "string"
        ? rawBody
        : new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    const parsed: unknown = JSON.parse(textBody);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** True if the JSON text has a number literal written with an exponent (outside strings). Linear. */
function hasExponentNumber(json: string): boolean {
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if ((c === "e" || c === "E") && /[0-9.]/.test(json[i - 1] ?? "")) {
      return true; // an exponent follows a digit; the e in true/false does not
    }
  }
  return false;
}

/** A dotted name is looked up flat first, then by walking nested objects. */
function lookup(body: Record<string, unknown>, name: string): { found: boolean; value?: unknown } {
  if (Object.hasOwn(body, name)) return { found: true, value: body[name] };
  let current: unknown = body;
  for (const part of name.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, part)
    ) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** A parsed webhook. Every field here is a hint: confirm with `orderStatus` before fulfilling. */
export interface WebhookPayload {
  orderId: string | undefined;
  transid: string | undefined;
  reference: string | undefined;
  result: string | undefined;
  /** Normalised result code. */
  resultcode: string | undefined;
  /** The gateway's raw `payment_status`, for example `COMPLETED`. */
  paymentStatus: string | undefined;
  /** `payment_status` mapped as for order status. A hint only. */
  status: Status;
  channel: string | undefined;
  /** As sent: a string, maybe with thousands separators (`"10,000"`). Not covered by the signature. */
  amount: string | undefined;
  /** Whole units parsed from `amount`; `undefined` when there was none. Not covered by the signature. */
  amountTzs: number | undefined;
  /** True when `amount` was present but is not a whole amount. It is not signed: never fulfil from it. */
  amountUnparsed: boolean;
  /** The payer's number (`phone`, or `msisdn` when that is what arrived). */
  phone: string | undefined;
  /** The whole decoded body. Unknown fields are kept and ignored. */
  body: Record<string, unknown>;
}

/**
 * Parses a webhook body (string or Buffer). Throws `WebhookParseError` only if it is not a JSON
 * object. `amount` is not a signed field, so a bad one never throws: `amountTzs` is `undefined` and
 * `amountUnparsed` is true. Verify first.
 */
export function parseWebhook(rawBody: string | Uint8Array): WebhookPayload {
  const body = parseJsonObject(rawBody);
  if (body === undefined) throw new WebhookParseError("the webhook body is not a JSON object");
  const amount = text(body.amount);
  let amountTzs: number | undefined;
  let amountUnparsed = false;
  if (body.amount !== undefined && body.amount !== null) {
    try {
      if (amount === undefined) throw new Error("not text");
      amountTzs = parseAmount(amount);
    } catch {
      amountUnparsed = true;
    }
  }
  return {
    orderId: text(body.order_id),
    transid: text(body.transid),
    reference: text(body.reference),
    result: text(body.result),
    resultcode: normalizeResultCode(body.resultcode),
    paymentStatus: text(body.payment_status),
    status: classifyPaymentStatus(body.payment_status),
    channel: text(body.channel),
    amount,
    amountTzs,
    amountUnparsed,
    phone: text(body.phone) ?? text(body.msisdn),
    body,
  };
}
