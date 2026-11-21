import type { Timeout } from "./config.js";
import { TransportError } from "./errors.js";
import {
  type RedactOptions,
  redactBodyText,
  redactHeaders,
  redactOptionsForUrl,
  redactUrl,
} from "./redact.js";
import type { HttpMethod } from "./signing.js";

export interface TransportRequest {
  method: HttpMethod;
  /** Absolute URL, query string included. */
  url: string;
  /** Includes the signing headers. Never log these as they are; see `redactHeaders`. */
  headers: Record<string, string>;
  /** JSON text, for POST. */
  body?: string;
  timeout: Timeout;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Lower-cased names. */
  headers: Record<string, string>;
  /** The whole body as text. */
  body: string;
}

/**
 * The HTTP layer. Implement it to add a proxy, logging, a custom HTTP client, or a test fake.
 *
 * Contract: resolve with the response for ANY HTTP status. When no response is received, throw
 * a `TransportError` that says `NOT_SENT` (the request provably never left) or `UNKNOWN_OUTCOME`
 * (it may have been written). If you cannot tell, say `UNKNOWN_OUTCOME`. Never retry inside a
 * transport.
 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  /**
   * Your own `fetch` (proxy dispatcher, instrumentation, a fake). Defaults to the global one.
   * It must NOT retry or resend a request on its own (no retry interceptor or middleware): a
   * silent resend of a POST would break the no-retry rule for payments. The default transport
   * also refuses to follow redirects, so a 307/308 can never replay a signed body elsewhere.
   */
  fetch?: typeof fetch;
}

// Failures that happen before anything is written: name resolution, refused or unreachable
// connection, connect timeout, and TLS handshake or certificate failures.
const NOT_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NODATA",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_INVALID_URL",
  "ERR_INVALID_ARG_VALUE",
  "UND_ERR_INVALID_ARG",
]);
// Only these mean "no request bytes were written": routing failures reported by the connect call
// itself (a mid-stream ENETUNREACH is not one of them).
const CONNECT_PHASE_ONLY = new Set(["ENETUNREACH", "EHOSTUNREACH"]);
// Certificate failures and handshake refusals. Deliberately NOT a blanket ERR_SSL_*: record-layer
// failures such as ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC and ERR_SSL_CIPHER_OPERATION_FAILED
// were seen after the server had received the request, so they are UNKNOWN_OUTCOME.
const TLS_CODE =
  /^(CERT_|ERR_TLS_CERT|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT|UNABLE_TO_(GET|VERIFY)_|HOSTNAME_MISMATCH|ERR_TLS_HANDSHAKE|ERR_SSL_(UNSUPPORTED_PROTOCOL|NO_PROTOCOLS_AVAILABLE|SSLV3_ALERT_HANDSHAKE_FAILURE|TLSV1_ALERT_PROTOCOL_VERSION)$)/;

/**
 * The default transport, over `fetch`. It never retries.
 *
 * Timeouts: `fetch` cannot separate "connecting" from "waiting for the response", so the wait for
 * the response headers is bounded by `connectMs + readMs`, and reading the body by `readMs`. A
 * timeout after the request was handed to the network is `UNKNOWN_OUTCOME`. Connect timeouts and
 * other failures the HTTP stack reports before sending (DNS, refused, TLS handshake) are
 * `NOT_SENT`. Pass your own `fetch` with a tuned dispatcher for a separate connect timeout.
 */
export function createFetchTransport(options: FetchTransportOptions = {}): Transport {
  return {
    async send(req: TransportRequest): Promise<TransportResponse> {
      const fetchFn = options.fetch ?? globalThis.fetch;
      if (typeof fetchFn !== "function") {
        throw new TransportError(
          "NOT_SENT",
          "no fetch available: use Node 20+ or pass `fetch` explicitly",
        );
      }
      const controller = new AbortController();
      let timedOut = false;
      const arm = (ms: number) =>
        setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, ms);
      const onCallerAbort = () => controller.abort();
      if (req.signal) {
        if (req.signal.aborted) {
          throw new TransportError("NOT_SENT", "aborted before the request was sent");
        }
        req.signal.addEventListener("abort", onCallerAbort, { once: true });
      }

      let timer = arm(req.timeout.connectMs + req.timeout.readMs);
      try {
        let res: Response;
        try {
          res = await fetchFn(req.url, {
            method: req.method,
            headers: req.headers,
            ...(req.body === undefined ? {} : { body: req.body }),
            signal: controller.signal,
            redirect: "manual",
          });
        } catch (e) {
          throw classifyFetchError(e, timedOut);
        }
        clearTimeout(timer);
        timer = arm(req.timeout.readMs);
        let body: string;
        try {
          body = await res.text();
        } catch (e) {
          throw new TransportError(
            "UNKNOWN_OUTCOME",
            timedOut
              ? "timed out reading the response"
              : "the connection failed while reading the response",
            e,
          );
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return { status: res.status, headers, body };
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onCallerAbort);
      }
    },
  };
}

/** Maps a `fetch` failure to NOT_SENT or UNKNOWN_OUTCOME. When in doubt, UNKNOWN_OUTCOME. */
export function classifyFetchError(error: unknown, timedOut = false): TransportError {
  if (error instanceof TransportError) return error;
  if (timedOut) {
    return new TransportError("UNKNOWN_OUTCOME", "timed out waiting for the response", error);
  }
  const found = collectCodes(error);
  const notSent = found.find(
    (f) =>
      NOT_SENT_CODES.has(f.code) ||
      TLS_CODE.test(f.code) ||
      (CONNECT_PHASE_ONLY.has(f.code) && f.syscall === "connect"),
  );
  if (notSent !== undefined) {
    return new TransportError("NOT_SENT", `the request was not sent (${notSent.code})`, error);
  }
  return new TransportError(
    "UNKNOWN_OUTCOME",
    `no response received; the gateway may have acted${found[0] ? ` (${found[0].code})` : ""}`,
    error,
  );
}

function collectCodes(
  error: unknown,
  depth = 0,
  out: Array<{ code: string; syscall?: string }> = [],
): Array<{ code: string; syscall?: string }> {
  if (depth > 5 || typeof error !== "object" || error === null) return out;
  const e = error as { code?: unknown; syscall?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string") {
    out.push({ code: e.code, ...(typeof e.syscall === "string" ? { syscall: e.syscall } : {}) });
  }
  collectCodes(e.cause, depth + 1, out);
  if (Array.isArray(e.errors)) for (const inner of e.errors) collectCodes(inner, depth + 1, out);
  return out;
}

export type LogEvent =
  | {
      type: "request";
      method: string;
      url: string;
      headers: Record<string, unknown>;
      body?: string;
    }
  | { type: "response"; status: number; headers: Record<string, unknown>; body: string }
  | { type: "error"; classification: string; message: string };

/**
 * Wraps a transport so that every request, response and transport error goes to `log` with
 * secrets and personal data redacted. The secret, PIN, `Authorization` and `Digest` are never
 * passed on.
 */
export function loggingTransport(
  inner: Transport,
  log: (event: LogEvent) => void,
  baseOptions?: RedactOptions,
): Transport {
  return {
    async send(req) {
      // Wallet cash-in paths carry a phone number in `utilityref`: mask it without being asked.
      const options = redactOptionsForUrl(req.url, baseOptions);
      log({
        type: "request",
        method: req.method,
        url: redactUrl(req.url, options),
        headers: redactHeaders(req.headers, options),
        ...(req.body === undefined ? {} : { body: redactBodyText(req.body, options) }),
      });
      try {
        const res = await inner.send(req);
        log({
          type: "response",
          status: res.status,
          headers: redactHeaders(res.headers, options),
          body: redactBodyText(res.body, options),
        });
        return res;
      } catch (e) {
        if (e instanceof TransportError) {
          log({ type: "error", classification: e.classification, message: e.message });
        }
        throw e;
      }
    },
  };
}
