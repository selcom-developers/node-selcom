import { describe, expect, it } from "vitest";
import type { LogEvent } from "../src/index.js";
import {
  classifyFetchError,
  createFetchTransport,
  loggingTransport,
  TransportError,
  type TransportRequest,
} from "../src/index.js";
import { FakeTransport, reply } from "./helpers.js";

const request: TransportRequest = {
  method: "GET",
  url: "https://apigwtest.selcommobile.com/v1/x?msisdn=255700000001",
  headers: {
    Authorization: "SELCOM c2VjcmV0",
    Digest: "abc=",
    Accept: "application/json",
  },
  timeout: { connectMs: 50, readMs: 50 },
};

function fetchFailing(cause: unknown): typeof fetch {
  return (async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause });
  }) as unknown as typeof fetch;
}

describe("classifyFetchError", () => {
  const notSent = [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ];
  for (const code of notSent) {
    it(`${code} is NOT_SENT`, () => {
      expect(
        classifyFetchError(new TypeError("fetch failed", { cause: { code } })).classification,
      ).toBe("NOT_SENT");
    });
  }

  for (const code of [
    "ECONNRESET",
    "UND_ERR_SOCKET",
    "ETIMEDOUT",
    "UND_ERR_BODY_TIMEOUT",
    "EPIPE",
  ]) {
    it(`${code} is UNKNOWN_OUTCOME`, () => {
      expect(
        classifyFetchError(new TypeError("fetch failed", { cause: { code } })).classification,
      ).toBe("UNKNOWN_OUTCOME");
    });
  }

  for (const code of [
    "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
    "ERR_SSL_CIPHER_OPERATION_FAILED",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "ERR_SSL_SOMETHING_NEW",
  ]) {
    it(`${code} (record layer, after the request may have been written) is UNKNOWN_OUTCOME`, () => {
      expect(
        classifyFetchError(new TypeError("fetch failed", { cause: { code } })).classification,
      ).toBe("UNKNOWN_OUTCOME");
    });
  }

  for (const code of ["ENETUNREACH", "EHOSTUNREACH"]) {
    it(`${code} is NOT_SENT only from the connect phase`, () => {
      const classify = (cause: object) =>
        classifyFetchError(new TypeError("fetch failed", { cause })).classification;
      expect(classify({ code, syscall: "connect" })).toBe("NOT_SENT");
      expect(classify({ code, syscall: "write" })).toBe("UNKNOWN_OUTCOME");
      expect(classify({ code })).toBe("UNKNOWN_OUTCOME");
    });
  }

  it("an error we cannot read is UNKNOWN_OUTCOME", () => {
    expect(classifyFetchError(new Error("???")).classification).toBe("UNKNOWN_OUTCOME");
    expect(classifyFetchError("string").classification).toBe("UNKNOWN_OUTCOME");
  });

  it("finds a code inside an AggregateError (dual-stack connect failure)", () => {
    const agg = new AggregateError([{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }]);
    expect(classifyFetchError(new TypeError("fetch failed", { cause: agg })).classification).toBe(
      "NOT_SENT",
    );
  });

  it("a timeout is UNKNOWN_OUTCOME", () => {
    expect(classifyFetchError(new Error("aborted"), true).classification).toBe("UNKNOWN_OUTCOME");
  });

  it("never puts the request in the message", () => {
    const e = classifyFetchError(
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
    );
    expect(e.message).not.toContain("SELCOM");
    expect(e.message).not.toContain("msisdn");
  });
});

describe("createFetchTransport", () => {
  it("returns any HTTP status as a response, with lower-cased header names", async () => {
    const fake = (async () =>
      new Response('{"resultcode":"000"}', {
        status: 502,
        headers: { "X-Thing": "1" },
      })) as unknown as typeof fetch;
    const res = await createFetchTransport({ fetch: fake }).send(request);
    expect(res.status).toBe(502);
    expect(res.headers["x-thing"]).toBe("1");
    expect(res.body).toBe('{"resultcode":"000"}');
  });

  it("passes method, headers and body to fetch and never follows redirects", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}");
    }) as unknown as typeof fetch;
    await createFetchTransport({ fetch: fake }).send({
      ...request,
      method: "POST",
      body: '{"a":1}',
    });
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.body).toBe('{"a":1}');
    expect(seen?.init.redirect).toBe("manual");
    expect(((seen?.init.headers ?? {}) as Record<string, string>).Digest).toBe("abc=");
  });

  it("classifies a refused connection as NOT_SENT", async () => {
    const t = createFetchTransport({ fetch: fetchFailing({ code: "ECONNREFUSED" }) });
    await expect(t.send(request)).rejects.toMatchObject({ classification: "NOT_SENT" });
  });

  it("classifies a reset as UNKNOWN_OUTCOME", async () => {
    const t = createFetchTransport({ fetch: fetchFailing({ code: "ECONNRESET" }) });
    await expect(t.send(request)).rejects.toMatchObject({ classification: "UNKNOWN_OUTCOME" });
  });

  it("times out waiting for headers as UNKNOWN_OUTCOME", async () => {
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const t = createFetchTransport({ fetch: hang });
    const error = await t
      .send({ ...request, timeout: { connectMs: 10, readMs: 10 } })
      .catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.classification).toBe("UNKNOWN_OUTCOME");
  });

  it("a failure while reading the body is UNKNOWN_OUTCOME", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("socket closed"));
      },
    });
    const fake = (async () => new Response(stream)) as unknown as typeof fetch;
    await expect(createFetchTransport({ fetch: fake }).send(request)).rejects.toMatchObject({
      classification: "UNKNOWN_OUTCOME",
    });
  });

  it("an abort before sending is NOT_SENT; an abort in flight is UNKNOWN_OUTCOME", async () => {
    const pre = new AbortController();
    pre.abort();
    const t = createFetchTransport({
      fetch: (async () => new Response("{}")) as unknown as typeof fetch,
    });
    await expect(t.send({ ...request, signal: pre.signal })).rejects.toMatchObject({
      classification: "NOT_SENT",
    });

    const during = new AbortController();
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const p = createFetchTransport({ fetch: hang }).send({ ...request, signal: during.signal });
    during.abort();
    await expect(p).rejects.toMatchObject({ classification: "UNKNOWN_OUTCOME" });
  });
});

describe("loggingTransport", () => {
  it("logs requests and responses with secrets and personal data redacted", async () => {
    const events: LogEvent[] = [];
    const inner = new FakeTransport(
      reply(200, { resultcode: "000", data: [{ phone: "255700000001", name: "Test Buyer" }] }),
    );
    const t = loggingTransport(inner, (e) => events.push(e));
    await t.send({ ...request, method: "POST", body: '{"pin":"1234","msisdn":"255700000001"}' });
    const shown = JSON.stringify(events);
    for (const secret of ["SELCOM c2VjcmV0", "abc=", "1234", "255700000001", "Test Buyer"]) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain("[REDACTED]");
    expect(shown).toContain("********0001");
    expect(events.map((e) => e.type)).toEqual(["request", "response"]);
    expect(inner.requests[0]?.headers.Digest).toBe("abc="); // the real request is untouched
  });

  it("masks utilityref on wallet cash-in paths without being asked, in bodies and queries", async () => {
    const events: LogEvent[] = [];
    const t = loggingTransport(
      new FakeTransport(reply(200, { resultcode: "000", data: [] })),
      (e) => events.push(e),
    );
    await t.send({
      ...request,
      method: "POST",
      url: "https://apigwtest.selcommobile.com/v1/walletcashin/process",
      body: '{"utilityref":"255700000002","utilitycode":"CASHIN"}',
    });
    await t.send({
      ...request,
      url: "https://apigwtest.selcommobile.com/v1/walletcashin/namelookup?utilitycode=CASHIN&utilityref=255700000002",
    });
    // On utilities, utilityref is a meter number and stays readable.
    await t.send({
      ...request,
      url: "https://apigwtest.selcommobile.com/v1/utilitypayment/lookup?utilityref=01234567890",
    });
    const shown = JSON.stringify(events);
    expect(shown).not.toContain("255700000002");
    expect(shown).toContain("********0002");
    expect(shown).toContain("01234567890");
  });

  it("logs a transport error and rethrows it", async () => {
    const events: LogEvent[] = [];
    const t = loggingTransport(new FakeTransport(new TransportError("NOT_SENT", "dns")), (e) =>
      events.push(e),
    );
    await expect(t.send(request)).rejects.toBeInstanceOf(TransportError);
    expect(events.at(-1)).toMatchObject({ type: "error", classification: "NOT_SENT" });
  });
});
