import { encode } from "./signing.js";

/** What a secret becomes. */
export const REDACTED = "[REDACTED]";

export interface RedactOptions {
  /**
   * Treat `utilityref` as a phone number. Right for wallet cash-in, where it is the receiving
   * wallet; wrong for utilities, where it is a meter or account number.
   */
  utilityrefIsPhone?: boolean;
}

type Kind = "secret" | "phone" | "email" | "name";

const SECRETS = new Set(["pin", "secret", "apisecret", "authorization", "digest", "cardtoken"]);
const PHONES = new Set(["msisdn", "phone", "buyerphone"]);
const EMAILS = new Set(["buyeremail", "email"]);
const NAMES = new Set(["buyername", "firstname", "lastname", "name"]);

function kindOf(key: string, options?: RedactOptions): Kind | undefined {
  // `billing.phone` and `shipping.firstname` are covered by the same rule as `phone` and `firstname`.
  const k = key
    .toLowerCase()
    .replace(/^(billing|shipping)\./, "")
    .replaceAll("_", "") // so typed camelCase fields (cardToken, buyerPhone) match like the wire names
    .trim();
  if (SECRETS.has(k)) return "secret";
  if (PHONES.has(k) || (options?.utilityrefIsPhone === true && k === "utilityref")) return "phone";
  if (EMAILS.has(k)) return "email";
  if (NAMES.has(k)) return "name";
  return undefined;
}

/** All but the last 4 characters replaced: `255700000001` becomes `********0001`. */
export function maskPhone(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}

/** First character of the local part, then the domain: `t***@example.com`. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1) return REDACTED;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** First character only: `T***`. */
export function maskName(value: string): string {
  return value.length === 0 ? value : `${[...value][0]}***`;
}

/** Redacts one field by its name. Unknown names pass through unchanged. */
export function redactValue(key: string, value: unknown, options?: RedactOptions): unknown {
  const kind = kindOf(key, options);
  if (kind === undefined) return value;
  if (kind === "secret") return REDACTED;
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (kind === "phone") return maskPhone(text);
  if (kind === "email") return maskEmail(text);
  return maskName(text);
}

/** Redacts header values (`Authorization`, `Digest`). Names match case-insensitively. */
export function redactHeaders<T extends Record<string, unknown>>(
  headers: T,
  options?: RedactOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = redactValue(name, value, options);
  }
  return out;
}

/** Redacts a flat or nested JSON value (parsed). Returns a new value; the input is not changed. */
export function redactBody(body: unknown, options?: RedactOptions): unknown {
  return walk(body, undefined, options);
}

function walk(value: unknown, key: string | undefined, options?: RedactOptions): unknown {
  if (key !== undefined && kindOf(key, options) !== undefined && !isContainer(value)) {
    return redactValue(key, value, options);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, key, options));
  if (isContainer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, k, options);
    }
    return out;
  }
  return value;
}

function isContainer(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

/**
 * Redacts a JSON body given as text and returns text. A body that is not JSON cannot be
 * redacted field by field, so it is replaced by a placeholder rather than logged.
 */
export function redactBodyText(text: string, options?: RedactOptions): string {
  try {
    return JSON.stringify(redactBody(JSON.parse(text), options));
  } catch {
    return `[non-JSON body omitted, ${text.length} characters]`;
  }
}

/** Redacts the values in a query string and returns it percent-encoded. */
export function redactQuery(query: string, options?: RedactOptions): string {
  const trimmed = query.startsWith("?") ? query.slice(1) : query;
  if (trimmed === "") return "";
  return trimmed
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      const key = safeDecode(rawKey);
      const redacted = redactValue(key, safeDecode(rawValue), options);
      return `${encode(key)}=${encode(String(redacted ?? ""))}`;
    })
    .join("&");
}

/**
 * Options for a request URL: on `/v1/walletcashin/` paths `utilityref` is the receiving wallet's
 * phone number, so it is masked automatically, in bodies and query strings alike.
 */
export function redactOptionsForUrl(url: string, options?: RedactOptions): RedactOptions {
  const path = url.split("?")[0] ?? "";
  return /\/v1\/walletcashin\//.test(path)
    ? { ...options, utilityrefIsPhone: true }
    : { ...options };
}

/** Redacts the query string of a URL. `utilityref` is masked on wallet cash-in paths. */
export function redactUrl(rawUrl: string, baseOptions?: RedactOptions): string {
  const url = rawUrl;
  const options = redactOptionsForUrl(url, baseOptions);
  const q = url.indexOf("?");
  if (q === -1) return url;
  return `${url.slice(0, q)}?${redactQuery(url.slice(q + 1), options)}`;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
