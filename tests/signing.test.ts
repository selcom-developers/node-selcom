import { describe, expect, it } from "vitest";
import type { Params } from "../src/index.js";
import { hs256Signer, SigningError, signRequest } from "../src/index.js";
import { loadJson, type SigningVectors } from "./vectors.js";

const vectors = loadJson<SigningVectors>("signing.json");

/** Reads a JSON body as an ordered list of [key, value] pairs (keys must keep their order). */
function orderedPairs(json: string): Array<[string, unknown]> {
  return Object.entries(JSON.parse(json) as Record<string, unknown>);
}

describe("signing vectors: cases", () => {
  it("has cases to run", () => {
    expect(vectors.cases.length).toBeGreaterThan(0);
  });

  for (const c of vectors.cases) {
    it(c.id, () => {
      const signed = signRequest({
        method: c.method,
        params: c.params as Params,
        timestamp: c.timestamp,
        apiKey: c.api_key,
        signer: hs256Signer(c.secret),
      });
      expect(signed.flattened).toEqual(c.expected.flattened);
      expect(signed.signedFields).toBe(c.expected.signed_fields);
      expect(signed.signingString).toBe(c.expected.signing_string);
      expect(signed.digest).toBe(c.expected.digest);
      expect(signed.headers.Digest).toBe(c.expected.digest);
      expect(signed.headers.Authorization).toBe(c.expected.authorization);
      expect(signed.headers["Digest-Method"]).toBe(c.expected.digest_method);
      expect(signed.headers["Signed-Fields"]).toBe(c.expected.signed_fields);
      expect(signed.headers.Timestamp).toBe(c.timestamp);

      if (c.method === "POST") {
        expect(signed.query).toBeUndefined();
        const expected = c.expected.body as string;
        // Same keys, same order, same values and JSON types; bytes may differ.
        expect(orderedPairs(signed.body as string)).toEqual(orderedPairs(expected));
        expect(signed.headers["Content-Type"]).toBe("application/json");
      } else {
        expect(signed.body).toBeUndefined();
        expect(signed.query).toBe(c.expected.query);
      }
    });
  }
});

describe("signing vectors: rejects", () => {
  it("has rejects to run", () => {
    expect(vectors.rejects.length).toBeGreaterThan(0);
  });

  for (const r of vectors.rejects) {
    it(`${r.id} -> ${r.error}`, () => {
      let error: unknown;
      try {
        signRequest({
          method: r.method,
          params: r.params as Params,
          timestamp: r.timestamp,
          apiKey: r.api_key,
          signer: hs256Signer(r.secret),
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SigningError);
      expect((error as SigningError).code).toBe(r.error);
    });
  }
});

describe("signer details", () => {
  const base = {
    timestamp: "2026-11-21T10:30:46+03:00",
    apiKey: "test-key-0001",
    signer: hs256Signer("test-secret-0001"),
  };

  it("accepts an ordered Map and an array of pairs, and keeps integer-like keys in order", () => {
    const fromMap = signRequest({
      ...base,
      method: "POST",
      params: new Map([
        ["23", "a"],
        ["b", "c"],
      ]),
    });
    expect(fromMap.signedFields).toBe("23,b");
    expect(fromMap.body).toBe('{"23":"a","b":"c"}');
    const fromPairs = signRequest({
      ...base,
      method: "POST",
      params: [
        ["23", "a"],
        ["b", "c"],
      ],
    });
    expect(fromPairs.digest).toBe(fromMap.digest);
  });

  it("omits undefined fields instead of sending them", () => {
    const s = signRequest({ ...base, method: "GET", params: { a: "1", b: undefined, c: "3" } });
    expect(s.signedFields).toBe("a,c");
  });

  it("encodes the query as RFC 3986 and signs the decoded text", () => {
    const s = signRequest({ ...base, method: "GET", params: { x: "a b+c!'()*~" } });
    expect(s.query).toBe("x=a%20b%2Bc%21%27%28%29%2A~");
    expect(s.signingString).toContain("x=a b+c!'()*~");
  });

  it("formats booleans and null explicitly", () => {
    const s = signRequest({ ...base, method: "POST", params: { t: true, f: false, n: null } });
    expect(s.signingString).toBe("timestamp=2026-11-21T10:30:46+03:00&t=true&f=false&n=");
    expect(s.body).toBe('{"t":true,"f":false,"n":""}');
  });

  it("accepts safe bigint and rejects unsafe bigint", () => {
    expect(signRequest({ ...base, method: "POST", params: { a: 8000n } }).body).toBe('{"a":8000}');
    expect(() => signRequest({ ...base, method: "POST", params: { a: 2n ** 60n } })).toThrow(
      SigningError,
    );
  });

  it("rejects NaN, Infinity, symbols and functions", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Symbol("x"), () => 1]) {
      expect(() => signRequest({ ...base, method: "POST", params: { a: v as never } })).toThrow(
        SigningError,
      );
    }
  });

  it("rejects a lone-surrogate value", () => {
    expect(() => signRequest({ ...base, method: "GET", params: { a: "\ud800" } })).toThrow(
      SigningError,
    );
  });

  it("keeps the secret out of the signer's visible shape", () => {
    const signer = hs256Signer("test-secret-0001");
    expect(JSON.stringify(signer)).not.toContain("test-secret-0001");
    expect(Object.getOwnPropertyNames(signer).join()).not.toContain("secret");
  });

  it("rejects an unsupported method and a signer that returns nothing", () => {
    expect(() => signRequest({ ...base, method: "PUT" as never, params: { a: "1" } })).toThrow(
      SigningError,
    );
    const broken = { method: "HS256", sign: () => "" };
    expect(() =>
      signRequest({ ...base, signer: broken, method: "POST", params: { a: "1" } }),
    ).toThrow(/empty digest/);
  });
});
