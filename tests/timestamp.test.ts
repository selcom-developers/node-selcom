import { describe, expect, it } from "vitest";
import { formatTimestamp, isValidTimestamp, parseTimestamp } from "../src/index.js";

describe("timestamp", () => {
  it("formats in +03:00 by default, without milliseconds or Z", () => {
    expect(formatTimestamp(new Date("2026-11-21T07:30:46.987Z"))).toBe("2026-11-21T10:30:46+03:00");
  });

  it("formats other offsets, crossing the date line", () => {
    expect(formatTimestamp(new Date("2026-11-21T23:30:00Z"), 180)).toBe(
      "2026-11-22T02:30:00+03:00",
    );
    expect(formatTimestamp(new Date("2026-11-21T07:30:00Z"), 0)).toBe("2026-11-21T07:30:00+00:00");
    expect(formatTimestamp(new Date("2026-11-21T07:30:00Z"), -330)).toBe(
      "2026-11-21T02:00:00-05:30",
    );
  });

  it("accepts both offset forms and returns the same instant", () => {
    const a = parseTimestamp("2026-11-21T10:30:46+03:00");
    expect(a).toBe(Date.parse("2026-11-21T07:30:46Z"));
    expect(parseTimestamp("2026-11-21T10:30:46+0300")).toBe(a);
  });

  it("rejects Z, fractions, impossible dates and garbage", () => {
    for (const t of [
      "2026-11-21T07:30:46Z",
      "2026-11-21T10:30:46.123+03:00",
      "2026-02-30T10:30:46+03:00",
      "2026-13-01T10:30:46+03:00",
      "2026-11-21T24:30:46+03:00",
      "2026-11-21 10:30:46+03:00",
      "",
    ]) {
      expect(isValidTimestamp(t), t).toBe(false);
    }
  });
});
