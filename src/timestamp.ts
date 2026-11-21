import { SigningError } from "./errors.js";

/** Source of the current time. Inject a fixed one in tests. */
export type Clock = () => Date;

/** Dar es Salaam: UTC+3, no daylight saving. */
export const DAR_ES_SALAAM_OFFSET_MINUTES = 180;

const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(:?)(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * Formats an instant as `yyyy-MM-ddTHH:mm:ss+HH:MM` in a fixed offset (default +03:00).
 * Never `Z`, never fractional seconds: `toISOString()` is not usable here.
 */
export function formatTimestamp(
  date: Date,
  offsetMinutes: number = DAR_ES_SALAAM_OFFSET_MINUTES,
): string {
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) >= 24 * 60) {
    throw new SigningError("INVALID_TIMESTAMP", "offsetMinutes must be an integer within +-23:59");
  }
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new SigningError("INVALID_TIMESTAMP", "invalid date");
  const local = new Date(Math.floor(ms / 1000) * 1000 + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** True when `text` matches `yyyy-MM-ddTHH:mm:ss±HH:MM` or `±HHMM`. */
export function isValidTimestamp(text: string): boolean {
  return parseTimestamp(text) !== undefined;
}

/** Epoch milliseconds for a spec timestamp, or `undefined` if it does not match the format. */
export function parseTimestamp(text: string): number | undefined {
  const m = TIMESTAMP_RE.exec(text);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, sign, oh, , om] = m as unknown as string[];
  const [Y, MO, D, H, MI, S, OH, OM] = [y, mo, d, h, mi, s, oh, om].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (MO < 1 || MO > 12 || D < 1 || H > 23 || MI > 59 || S > 59 || OH > 23 || OM > 59) {
    return undefined;
  }
  const utc = Date.UTC(Y, MO - 1, D, H, MI, S);
  const check = new Date(utc);
  if (check.getUTCMonth() !== MO - 1 || check.getUTCDate() !== D) return undefined;
  const offset = (OH * 60 + OM) * 60_000 * (sign === "-" ? -1 : 1);
  return utc - offset;
}
