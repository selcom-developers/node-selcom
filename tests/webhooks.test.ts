import { describe, expect, it } from "vitest";
import {
  ConfigError,
  createWebhookVerifier,
  MemoryReplayStore,
  parseTimestamp,
  parseWebhook,
  ReplayStoreError,
  WebhookParseError,
  webhookResponse,
} from "../src/index.js";
import { loadJson } from "./vectors.js";

interface Sample {
  name: string;
  headers: Record<string, string>;
  raw_body: string;
  expected_verification: string;
  expected_amount_tzs: number;
}

interface WebhookFile {
  verification: { secret: string; now: string; window_seconds: number };
  samples: Sample[];
}

const file = loadJson<WebhookFile>("responses", "checkout.webhook.json");
const now = new Date(file.verification.now);

function verifier(overrides = {}) {
  return createWebhookVerifier({
    secret: file.verification.secret,
    clock: () => now,
    windowSeconds: file.verification.window_seconds,
    ...overrides,
  });
}

describe("webhook vectors", () => {
  it("has samples to run", () => {
    expect(file.samples.length).toBeGreaterThan(0);
  });

  // The samples run in order through ONE replay store, as the spec says.
  const v = verifier();
  for (const s of file.samples) {
    it(`${s.name} -> ${s.expected_verification}`, async () => {
      expect(await v.verify(s.headers, s.raw_body)).toBe(s.expected_verification);
      expect(parseWebhook(s.raw_body).amountTzs).toBe(s.expected_amount_tzs);
    });
  }
});

describe("webhook verification details", () => {
  const sample = file.samples[0] as Sample;

  it("accepts the raw body as a Buffer", async () => {
    expect(await verifier().verify(sample.headers, Buffer.from(sample.raw_body, "utf8"))).toBe(
      "VALID",
    );
  });

  it("matches header names case-insensitively, in a plain object, a Map and a Headers", async () => {
    const lower = Object.fromEntries(
      Object.entries(sample.headers).map(([k, val]) => [k.toLowerCase(), val]),
    );
    expect(await verifier().verify(lower, sample.raw_body)).toBe("VALID");
    expect(await verifier().verify(new Map(Object.entries(sample.headers)), sample.raw_body)).toBe(
      "VALID",
    );
    expect(await verifier().verify(new Headers(sample.headers), sample.raw_body)).toBe("VALID");
  });

  it("treats a repeated Digest header as invalid", async () => {
    const headers = { ...sample.headers, Digest: [sample.headers.Digest as string, "x"] };
    expect(await verifier().verify(headers, sample.raw_body)).toBe("INVALID");
  });

  it("honours a configured window", async () => {
    // The sample is 14 seconds old: fine at 300 s, stale at 10 s.
    expect(await verifier({ windowSeconds: 10 }).verify(sample.headers, sample.raw_body)).toBe(
      "STALE",
    );
    expect(await verifier({ windowSeconds: 20 }).verify(sample.headers, sample.raw_body)).toBe(
      "VALID",
    );
  });

  it("treats a future timestamp beyond the window as stale", async () => {
    const early = verifier({ clock: () => new Date(now.getTime() - 3_600_000) });
    expect(await early.verify(sample.headers, sample.raw_body)).toBe("STALE");
  });

  it("rejects a body that is not a JSON object, a missing method and empty Signed-Fields", async () => {
    const v = verifier();
    expect(await v.verify(sample.headers, "[1,2]")).toBe("INVALID");
    expect(await v.verify(sample.headers, "not json")).toBe("INVALID");
    expect(await v.verify(sample.headers, new Uint8Array([0xff, 0xfe]))).toBe("INVALID");
    const { "Digest-Method": _m, ...noMethod } = sample.headers;
    expect(await v.verify(noMethod, sample.raw_body)).toBe("INVALID");
    expect(await v.verify({ ...sample.headers, "Signed-Fields": "" }, sample.raw_body)).toBe(
      "INVALID",
    );
    expect(
      await v.verify({ ...sample.headers, Timestamp: "2026-11-21T07:30:46Z" }, sample.raw_body),
    ).toBe("INVALID");
  });

  it("supports an async replay store", async () => {
    const seen = new Set<string>();
    const store = {
      seen: async (d: string) => {
        const had = seen.has(d);
        seen.add(d);
        return had;
      },
    };
    const v = verifier({ replayStore: store });
    expect(await v.verify(sample.headers, sample.raw_body)).toBe("VALID");
    expect(await v.verify(sample.headers, sample.raw_body)).toBe("REPLAY");
  });

  it("forgets a digest once the window has passed", () => {
    const store = new MemoryReplayStore();
    expect(store.seen("d", 0, 1000)).toBe(false);
    expect(store.seen("d", 500, 1000)).toBe(true);
    expect(store.seen("d", 1500, 2500)).toBe(false);
  });

  it("remembers a digest until max(now, signed timestamp) + window", async () => {
    const calls: number[] = [];
    const store = {
      seen: (_d: string, _now: number, expires: number) => {
        calls.push(expires);
        return false;
      },
    };
    // Sample timestamp is 14 s before `now`: expiry is now + window.
    await verifier({ replayStore: store }).verify(sample.headers, sample.raw_body);
    expect(calls[0]).toBe(now.getTime() + 300_000);
    // A signed timestamp in the future (still inside the window) extends it to timestamp + window.
    const ts = parseTimestamp(sample.headers.Timestamp as string) as number;
    const early = verifier({ replayStore: store, clock: () => new Date(ts - 60_000) });
    expect(await early.verify(sample.headers, sample.raw_body)).toBe("VALID");
    expect(calls[1]).toBe(ts + 300_000);
  });

  it("decides exponent numbers in signed fields without expanding them", async () => {
    const v = verifier();
    const base = { ...sample.headers, "Signed-Fields": "transid,order_id,a" };
    for (const num of ["1e100000000", "1e-999999999", "8e3", "1E2"]) {
      const started = Date.now();
      expect(await v.verify(base, `{"transid":"T","order_id":"O","a":${num}}`)).toBe("INVALID");
      expect(Date.now() - started).toBeLessThan(500);
    }
    // true/false contain an "e" but are not exponent numbers: they reach the digest check.
    expect(await v.verify(base, '{"transid":"T","order_id":"O","a":true}')).toBe("INVALID");
  });

  it("requires order_id and transid among the signed fields", async () => {
    const v = verifier();
    for (const fields of ["order_id,reference", "transid,reference", "reference"]) {
      expect(await v.verify({ ...sample.headers, "Signed-Fields": fields }, sample.raw_body)).toBe(
        "INVALID",
      );
    }
  });

  it("never throws, whatever it is given", async () => {
    const v = verifier();
    const oddInputs = [
      "x".repeat(2 * 1024 * 1024),
      `{"a":${"[".repeat(100_000)}}`,
      '{"transid":1e999999999,"a":123456789012345678901234567890}',
    ];
    for (const body of oddInputs) {
      const headers = { ...sample.headers, "Signed-Fields": "transid,a" };
      expect(await v.verify(headers, body)).toBe("INVALID");
    }
    expect(await v.verify(null as never, "{}")).toBe("INVALID");
  });

  it("raises ReplayStoreError when the replay store throws or rejects", async () => {
    const stores = [
      {
        seen: () => {
          throw new Error("store down");
        },
      },
      { seen: () => Promise.reject(new Error("store down")) },
    ];
    for (const replayStore of stores) {
      const error = await verifier({ replayStore })
        .verify(sample.headers, sample.raw_body)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ReplayStoreError);
      expect((error as ReplayStoreError).message).not.toContain("store down");
    }
    // Deliveries that never reach the store are still plain verdicts.
    const down = verifier({ replayStore: stores[0] });
    expect(await down.verify(sample.headers, "not json")).toBe("INVALID");
  });

  it("refuses to be built without a secret", () => {
    expect(() => createWebhookVerifier({ secret: "" })).toThrow(ConfigError);
  });

  it("maps verdicts to a response and a decision", () => {
    expect(webhookResponse("VALID")).toEqual({ httpStatus: 200, process: true });
    expect(webhookResponse("UNSIGNED")).toEqual({ httpStatus: 200, process: true });
    expect(webhookResponse("REPLAY")).toEqual({ httpStatus: 200, process: false });
    expect(webhookResponse("INVALID")).toEqual({ httpStatus: 401, process: false });
    expect(webhookResponse("STALE")).toEqual({ httpStatus: 401, process: false });
  });
});

describe("parseWebhook", () => {
  it("parses the documented fields and keeps unknown ones", () => {
    const p = parseWebhook(
      '{"order_id":"ORD-1","transid":"TXN-1","reference":"R1","result":"SUCCESS","resultcode":0,"payment_status":"COMPLETED","channel":"X","amount":"10,000","msisdn":"255700000001","extra":1}',
    );
    expect(p).toMatchObject({
      orderId: "ORD-1",
      transid: "TXN-1",
      resultcode: "000",
      status: "SUCCESS",
      amount: "10,000",
      amountTzs: 10000,
      phone: "255700000001",
    });
    expect(p.body.extra).toBe(1);
  });

  it("throws only on a non-object body", () => {
    expect(() => parseWebhook("[]")).toThrow(WebhookParseError);
  });

  it("never throws on a bad amount: it is unsigned, so it is flagged instead", () => {
    for (const amount of ['"10.50"', '"abc"', "1.5", "[1]", '{"a":1}', "true", '"-5"']) {
      const p = parseWebhook(`{"order_id":"ORD-1","amount":${amount}}`);
      expect(p.amountTzs, amount).toBeUndefined();
      expect(p.amountUnparsed, amount).toBe(true);
      expect(p.orderId).toBe("ORD-1");
    }
    const good = parseWebhook('{"amount":"10,000"}');
    expect(good).toMatchObject({ amountTzs: 10000, amountUnparsed: false });
    expect(parseWebhook("{}")).toMatchObject({ amountTzs: undefined, amountUnparsed: false });
  });
});
