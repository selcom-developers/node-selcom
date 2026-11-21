import { createHmac } from "node:crypto";
import { SigningError } from "./errors.js";
import { isValidTimestamp } from "./timestamp.js";

/** Largest integer JavaScript holds exactly. Anything beyond must travel as a string. */
export const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** A value a caller may give. `undefined` means "leave this field out". */
export type ParamValue = string | number | bigint | boolean | null | undefined | ParamObject;

/**
 * A nested group such as `billing`. A `Map` keeps the order you give. A plain object keeps it too,
 * except that integer-like keys such as `"23"` sort first (a JavaScript rule).
 */
export type ParamObject = { [key: string]: ParamValue } | Map<string, ParamValue>;

/** Request parameters in send order: a `Map`, an array (or other iterable) of `[key, value]` pairs, or a plain object. */
export type Params = ParamObject | Iterable<readonly [string, ParamValue]>;

/** What goes on the wire for one field (and into the signature as text). */
export type WireValue = string | number | boolean;

export type HttpMethod = "GET" | "POST" | "DELETE";

/** The digest step. HS256 ships; an RS256 signer can be added without touching request building. */
export interface Signer {
  /** Sent as `Digest-Method`. */
  readonly method: string;
  /** Returns the base64 digest of the signing string. Never empty. */
  sign(signingString: string): string;
}

/** HMAC-SHA256 keyed with the API secret (UTF-8 text; do not hex-decode it). */
export function hs256Signer(secret: string): Signer {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new SigningError("EMPTY_SECRET", "the API secret is empty");
  }
  // Held in a closure: invisible to util.inspect, JSON.stringify and error messages.
  const key = Buffer.from(secret, "utf8");
  return Object.freeze({
    method: "HS256",
    sign(signingString: string): string {
      return createHmac("sha256", key).update(signingString, "utf8").digest("base64");
    },
  });
}

export interface SignInput {
  method: HttpMethod;
  params: Params;
  /** Exactly the text to send as `Timestamp`, e.g. from `formatTimestamp`. */
  timestamp: string;
  apiKey: string;
  signer: Signer;
}

export interface SignedRequest {
  method: HttpMethod;
  /** Flattened pairs in send order with normalised (wire) values. */
  flattened: Array<[string, WireValue]>;
  /** Keys joined with `,` and no spaces. */
  signedFields: string;
  signingString: string;
  digest: string;
  timestamp: string;
  /** Authorization, Digest-Method, Digest, Timestamp, Signed-Fields, Accept (and Content-Type on POST). */
  headers: Record<string, string>;
  /** Percent-encoded query string, for GET and DELETE. */
  query?: string;
  /** Flat JSON body, for POST. */
  body?: string;
}

const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Signs a request. Pure: no I/O and no clock. Throws `SigningError` on anything the spec says to
 * refuse; after that error nothing may be sent.
 */
export function signRequest(input: SignInput): SignedRequest {
  const { method, params, timestamp, apiKey, signer } = input;
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    throw new SigningError("INVALID_METHOD", `unsupported method: ${String(method)}`);
  }
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new SigningError("EMPTY_API_KEY", "the API key is empty");
  }
  if (typeof timestamp !== "string" || !isValidTimestamp(timestamp)) {
    throw new SigningError(
      "INVALID_TIMESTAMP",
      "timestamp must be yyyy-MM-ddTHH:mm:ss+HH:MM (or +HHMM), no fractional seconds, no Z",
    );
  }

  const flattened = flatten(params);
  if (flattened.length === 0) {
    throw new SigningError("EMPTY_PARAMS", "a request needs at least one parameter");
  }

  const signedFields = flattened.map(([k]) => k).join(",");
  const signingString = `timestamp=${timestamp}${flattened
    .map(([k, v]) => `&${k}=${signedText(v)}`)
    .join("")}`;
  const digest = signer.sign(signingString);
  if (typeof digest !== "string" || digest.length === 0) {
    throw new SigningError("EMPTY_DIGEST", "the signer returned an empty digest");
  }

  const headers: Record<string, string> = {
    Authorization: `SELCOM ${Buffer.from(apiKey, "utf8").toString("base64")}`,
    "Digest-Method": signer.method,
    Digest: digest,
    Timestamp: timestamp,
    "Signed-Fields": signedFields,
    Accept: "application/json",
  };

  const signed: SignedRequest = {
    method,
    flattened,
    signedFields,
    signingString,
    digest,
    timestamp,
    headers,
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    signed.body = flatJson(flattened);
  } else {
    signed.query = flattened.map(([k, v]) => `${encode(k)}=${encode(signedText(v))}`).join("&");
  }
  return signed;
}

/** The text of a normalised value as it appears in the signing string. */
export function signedText(value: WireValue): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * Flattens parameters in place (`billing: {firstname}` becomes `billing.firstname` where `billing`
 * was), validates keys, and normalises values. Pure.
 */
export function flatten(params: Params): Array<[string, WireValue]> {
  const out: Array<[string, WireValue]> = [];
  walk(topLevelEntries(params), "", out, new Set());
  return out;
}

/** Normalises one value as the spec's value table says; throws `SigningError` for rejected values. */
export function normalizeValue(value: unknown, key = "value"): WireValue {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new SigningError("INVALID_VALUE", `${key}: string is not valid Unicode`);
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (value === null) return "";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new SigningError(
        "NON_INTEGER_NUMBER",
        `${key}: ${String(value)} is not a whole number (amounts are whole units; never rounded)`,
      );
    }
    if (Math.abs(value) > MAX_SAFE) {
      throw new SigningError(
        "NUMBER_OUT_OF_RANGE",
        `${key}: integer beyond +-(2^53 - 1); send it as a string`,
      );
    }
    return value === 0 ? 0 : value; // folds -0 into 0
  }
  if (typeof value === "bigint") {
    if (value > BigInt(MAX_SAFE) || value < -BigInt(MAX_SAFE)) {
      throw new SigningError(
        "NUMBER_OUT_OF_RANGE",
        `${key}: integer beyond +-(2^53 - 1); send it as a string`,
      );
    }
    return Number(value);
  }
  throw new SigningError(
    "UNSUPPORTED_TYPE",
    `${key}: ${Array.isArray(value) ? "arrays have no flat form" : typeof value} is not a supported value`,
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function topLevelEntries(params: Params): Array<readonly [string, ParamValue]> {
  if (params instanceof Map) return [...params.entries()];
  if (isPlainObject(params)) return Object.entries(params) as Array<[string, ParamValue]>;
  if (params && typeof (params as Iterable<unknown>)[Symbol.iterator] === "function") {
    const pairs: Array<readonly [string, ParamValue]> = [];
    for (const pair of params as Iterable<readonly [string, ParamValue]>) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
        throw new SigningError("UNSUPPORTED_TYPE", "params must be [key, value] pairs");
      }
      pairs.push(pair as readonly [string, ParamValue]);
    }
    return pairs;
  }
  throw new SigningError(
    "UNSUPPORTED_TYPE",
    "params must be an object, a Map or [key, value] pairs",
  );
}

function walk(
  entries: Array<readonly [string, ParamValue]>,
  prefix: string,
  out: Array<[string, WireValue]>,
  seen: Set<string>,
): void {
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    assertKey(key);
    if (value instanceof Map || isPlainObject(value)) {
      const nested = (value instanceof Map ? [...value.entries()] : Object.entries(value)) as Array<
        readonly [string, ParamValue]
      >;
      if (nested.every(([, v]) => v === undefined)) {
        throw new SigningError("EMPTY_OBJECT", `${key}: empty object; omit it`);
      }
      walk(nested, key, out, seen);
      continue;
    }
    if (seen.has(key)) {
      throw new SigningError("DUPLICATE_KEY", `${key}: appears twice after flattening`);
    }
    seen.add(key);
    out.push([key, normalizeValue(value, key)]);
  }
}

function assertKey(key: string): void {
  if (key.length === 0 || !key.split(".").every((s) => KEY_SEGMENT.test(s))) {
    throw new SigningError(
      "INVALID_KEY",
      `${JSON.stringify(key)}: keys use A-Z a-z 0-9 _ - joined by "."`,
    );
  }
}

/** RFC 3986 percent-encoding of UTF-8: everything except `A-Z a-z 0-9 - . _ ~`. */
export function encode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Builds the flat JSON body by hand so that integer-like keys keep their order. */
function flatJson(pairs: Array<[string, WireValue]>): string {
  return `{${pairs.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")}}`;
}

function hasLoneSurrogate(value: string): boolean {
  const wf = (value as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wf === "function") return !wf.call(value);
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value);
}
