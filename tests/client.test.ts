import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  hs256Signer,
  InvalidResponseError,
  operations,
  SelcomClient,
  SelcomConfig,
  SigningError,
  signRequest,
  TransportError,
  USER_AGENT,
  ValidationError,
  VERSION,
} from "../src/index.js";
import { CONFIG, FakeTransport, FIXED_NOW, makeClient, reply } from "./helpers.js";

const ok = { resultcode: "000", result: "SUCCESS", message: "ok", reference: "R1", data: [] };
const order = {
  orderId: "ORD-1001",
  buyerEmail: "buyer@example.com",
  buyerName: "Test Buyer",
  buyerPhone: "255700000001",
  amount: 8000,
  currency: "TZS" as const,
  noOfItems: 1,
};

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`selcom-node/${pkg.version}`);
  });
});

describe("config", () => {
  it("requires an explicit environment: there is no default", () => {
    const { environment: _e, ...rest } = CONFIG;
    expect(() => new SelcomConfig(rest as never)).toThrow(/environment is required/);
    expect(() => new SelcomConfig({ ...CONFIG, environment: "prod" as never })).toThrow(
      ConfigError,
    );
  });

  it("uses the spec base URLs", () => {
    expect(new SelcomConfig({ ...CONFIG, environment: "production" }).baseUrl).toBe(
      "https://apigw.selcommobile.com",
    );
    expect(new SelcomConfig(CONFIG).baseUrl).toBe("https://apigwtest.selcommobile.com");
  });

  it("allows a custom base URL only as its own explicit choice", () => {
    expect(() => new SelcomConfig({ ...CONFIG, baseUrl: "https://proxy.example.com" })).toThrow(
      /preset/,
    );
    expect(() => new SelcomConfig({ ...CONFIG, environment: "custom" })).toThrow(/baseUrl/);
    expect(
      new SelcomConfig({
        ...CONFIG,
        environment: "custom",
        baseUrl: "https://proxy.example.com/x/",
      }).baseUrl,
    ).toBe("https://proxy.example.com/x");
    expect(
      new SelcomConfig({ ...CONFIG, environment: "custom", baseUrl: "http://localhost:8080" })
        .baseUrl,
    ).toBe("http://localhost:8080");
    expect(
      () => new SelcomConfig({ ...CONFIG, environment: "custom", baseUrl: "http://example.com" }),
    ).toThrow(ConfigError);
  });

  it("fails at construction for a missing key, secret or vendor", () => {
    for (const field of ["apiKey", "secret", "vendor"] as const) {
      expect(() => new SelcomConfig({ ...CONFIG, [field]: "" })).toThrow(ConfigError);
      expect(() => new SelcomConfig({ ...CONFIG, [field]: undefined as never })).toThrow(
        ConfigError,
      );
    }
  });

  it("has the spec's timeout defaults and validates overrides", () => {
    const c = new SelcomConfig(CONFIG);
    expect(c.timeouts.query).toEqual({ connectMs: 10_000, readMs: 10_000 });
    expect(c.timeouts.moneyMoving).toEqual({ connectMs: 15_000, readMs: 180_000 });
    const t = new SelcomConfig({ ...CONFIG, timeouts: { moneyMoving: { readMs: 5000 } } });
    expect(t.timeouts.moneyMoving).toEqual({ connectMs: 15_000, readMs: 5000 });
    expect(() => new SelcomConfig({ ...CONFIG, timeouts: { query: { readMs: 0 } } })).toThrow(
      ConfigError,
    );
  });

  it("keeps secrets out of toString, JSON, inspect and errors", () => {
    const c = new SelcomConfig({
      ...CONFIG,
      checkout: { apiKey: "co-key-0002", secret: "co-secret-0002" },
    });
    for (const shown of [String(c), JSON.stringify(c), JSON.stringify({ c })]) {
      expect(shown).not.toContain("test-secret-0001");
      expect(shown).not.toContain("co-secret-0002");
      expect(shown).not.toContain('"0000"');
    }
    expect(String(c)).toContain("apiKey=****0001");
    expect(String(c)).not.toContain("test-key-0001");
    expect(JSON.stringify(c)).not.toContain("test-key-0001");
    expect(JSON.stringify(c)).not.toContain("co-key-0002");
    expect(JSON.stringify(c)).toContain("****0002");
    const client = new SelcomClient({ config: c, transport: new FakeTransport(reply(200, ok)) });
    expect(JSON.stringify(client)).not.toContain("test-secret-0001");
  });

  it("requires the PIN only when a payout operation is called", async () => {
    const { pin: _p, ...noPin } = CONFIG;
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport, {}, { pin: undefined });
    expect(new SelcomConfig(noPin)).toBeDefined();
    await expect(
      client.utilityPayment({ transid: "T1", utilityCode: "LUKU", utilityRef: "1", amount: 1000 }),
    ).rejects.toThrow(ConfigError);
    expect(transport.requests).toHaveLength(0);
  });
});

describe("client wire behaviour", () => {
  it("signs every request so that the signature verifies, with a fresh timestamp", async () => {
    const times = [new Date("2026-11-21T07:30:46Z"), new Date("2026-11-21T07:30:47Z")];
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport, { clock: () => times.shift() ?? FIXED_NOW });
    await client.orderStatus({ orderId: "ORD-1001" });
    await client.orderStatus({ orderId: "ORD-1001" });
    const [a, b] = transport.requests;
    expect(a?.headers.Timestamp).toBe("2026-11-21T10:30:46+03:00");
    expect(b?.headers.Timestamp).toBe("2026-11-21T10:30:47+03:00");
    expect(a?.headers.Digest).not.toBe(b?.headers.Digest);
    const expected = signRequest({
      method: "GET",
      params: { order_id: "ORD-1001" },
      timestamp: "2026-11-21T10:30:46+03:00",
      apiKey: CONFIG.apiKey,
      signer: hs256Signer(CONFIG.secret),
    });
    expect(a?.headers.Digest).toBe(expected.digest);
    expect(a?.url).toBe(
      "https://apigwtest.selcommobile.com/v1/checkout/order-status?order_id=ORD-1001",
    );
    expect(a?.headers["User-Agent"]).toBe(USER_AGENT);
    expect(a?.body).toBeUndefined();
  });

  it("sends flat dotted keys and base64 URLs, signed in that form", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport);
    await client.createOrder({
      ...order,
      paymentMethods: ["CARD", "MOBILEMONEYPULL"],
      webhookUrl: "https://example.com/hook",
      billing: {
        firstName: "Test",
        lastName: "Buyer",
        address1: "1 Test Road",
        city: "Dar es Salaam",
        stateOrRegion: "Dar es Salaam",
        postcodeOrPobox: "00000",
        country: "TZ",
        phone: "255700000001",
      },
    });
    const req = transport.requests[0];
    const body = JSON.parse(req?.body ?? "{}") as Record<string, unknown>;
    expect(body.vendor).toBe("TILL123");
    expect(body.payment_methods).toBe("CARD,MOBILEMONEYPULL");
    expect(body.webhook).toBe(Buffer.from("https://example.com/hook").toString("base64"));
    expect(body["billing.firstname"]).toBe("Test");
    expect(body.billing).toBeUndefined();
    expect(body.amount).toBe(8000);
    expect(req?.headers["Signed-Fields"]).toBe(Object.keys(body).join(","));
    expect(body.shipping).toBeUndefined();
  });

  it("uses the separate checkout credentials for checkout and the main ones for payouts", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(
      transport,
      {},
      { checkout: { apiKey: "co-key-0002", secret: "co-secret-0002" } },
    );
    await client.orderStatus({ orderId: "ORD-1" });
    await client.utilityQuery({ transid: "T1" });
    const b64 = (k: string) => `SELCOM ${Buffer.from(k).toString("base64")}`;
    expect(transport.requests[0]?.headers.Authorization).toBe(b64("co-key-0002"));
    expect(transport.requests[1]?.headers.Authorization).toBe(b64("test-key-0001"));
  });

  it("uses the money-moving timeout for payments and the query timeout otherwise", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport);
    await client.utilityPayment({
      transid: "T1",
      utilityCode: "LUKU",
      utilityRef: "1",
      amount: 1000,
    });
    await client.utilityQuery({ transid: "T1" });
    expect(transport.requests[0]?.timeout).toEqual({ connectMs: 15_000, readMs: 180_000 });
    expect(transport.requests[1]?.timeout).toEqual({ connectMs: 10_000, readMs: 10_000 });
  });

  it("takes the verdict from resultcode, ignoring result text and HTTP status", async () => {
    const t = new FakeTransport(
      reply(500, { resultcode: "111", result: "SUCCESS", message: "m", data: [] }),
    );
    const r = await makeClient(t).utilityPayment({
      transid: "T1",
      utilityCode: "LUKU",
      utilityRef: "1",
      amount: 1000,
    });
    expect(r.status).toBe("PENDING");
    expect(r.httpStatus).toBe(500);
    expect(r.isFinal()).toBe(false);
    expect(r.transid).toBe("T1");
  });

  it("decodes the base64 payment_gateway_url and keeps the raw value", async () => {
    const raw = Buffer.from("https://pay.example.com/ORD-1").toString("base64");
    const t = new FakeTransport(
      reply(200, {
        ...ok,
        data: [
          { gateway_buyer_uuid: "G1", payment_token: "123", qr: "Q", payment_gateway_url: raw },
        ],
      }),
    );
    const r = await makeClient(t).createOrderMinimal(order);
    expect(r.data[0]).toMatchObject({
      gatewayBuyerUuid: "G1",
      paymentGatewayUrl: "https://pay.example.com/ORD-1",
      paymentGatewayUrlRaw: raw,
    });
  });

  it("maps order status fields, accepting phone or msisdn", async () => {
    const t = new FakeTransport(
      reply(200, {
        ...ok,
        data: [
          {
            order_id: "ORD-1",
            amount: "10,000",
            payment_status: "COMPLETED",
            phone: "255700000001",
          },
        ],
      }),
    );
    const r = await makeClient(t).orderStatus({ orderId: "ORD-1" });
    expect(r.status).toBe("SUCCESS");
    expect(r.data[0]).toMatchObject({
      amountTzs: 10000,
      msisdn: "255700000001",
      paymentStatus: "COMPLETED",
    });
    expect(r.orderId).toBe("ORD-1");
  });

  it("JSON-serialises a result with personal data masked", async () => {
    const t = new FakeTransport(
      reply(200, {
        ...ok,
        data: [{ order_id: "ORD-1", payment_status: "COMPLETED", phone: "255700000001" }],
      }),
    );
    const r = await makeClient(t).orderStatus({ orderId: "ORD-1" });
    const shown = JSON.stringify(r);
    expect(shown).not.toContain("255700000001");
    expect(shown).toContain("********0001");
  });
});

describe("never retry payments or writes", () => {
  const notSent = () => new TransportError("NOT_SENT", "dns");
  const unknown = () => new TransportError("UNKNOWN_OUTCOME", "reset");
  const payment = { transid: "T1", utilityCode: "LUKU", utilityRef: "1", amount: 1000 };

  for (const [label, error] of [
    ["NOT_SENT", notSent],
    ["UNKNOWN_OUTCOME", unknown],
  ] as const) {
    it(`a payment that fails with ${label} is sent once, even with retries opted in`, async () => {
      const transport = new FakeTransport(error());
      const client = makeClient(transport, {}, { retryNotSent: 3 });
      await expect(client.utilityPayment(payment)).rejects.toMatchObject({ classification: label });
      expect(transport.requests).toHaveLength(1);
    });
  }

  it("writes (create-order, cancel-order, delete-card) are sent once even with retries opted in", async () => {
    const transport = new FakeTransport(notSent());
    const client = makeClient(transport, {}, { retryNotSent: 3 });
    await expect(client.cancelOrder({ orderId: "ORD-1" })).rejects.toBeInstanceOf(TransportError);
    await expect(client.deleteCard({ id: 1, gatewayBuyerUuid: "G" })).rejects.toBeInstanceOf(
      TransportError,
    );
    await expect(client.createOrderMinimal(order)).rejects.toBeInstanceOf(TransportError);
    expect(transport.requests).toHaveLength(3);
  });

  it("does not retry reads by default", async () => {
    const transport = new FakeTransport(notSent());
    await expect(makeClient(transport).orderStatus({ orderId: "ORD-1" })).rejects.toBeInstanceOf(
      TransportError,
    );
    expect(transport.requests).toHaveLength(1);
  });

  it("retries a read only after NOT_SENT, only when opted in, with a fresh timestamp", async () => {
    const times = [0, 1, 2].map((s) => new Date(FIXED_NOW.getTime() + s * 1000));
    const transport = new FakeTransport(notSent(), notSent(), reply(200, ok));
    const client = makeClient(
      transport,
      { clock: () => times.shift() ?? FIXED_NOW },
      { retryNotSent: 2 },
    );
    const r = await client.orderStatus({ orderId: "ORD-1" });
    expect(r.httpStatus).toBe(200);
    expect(transport.requests).toHaveLength(3);
    expect(new Set(transport.requests.map((q) => q.headers.Timestamp)).size).toBe(3);
  });

  it("never retries a read after UNKNOWN_OUTCOME", async () => {
    const transport = new FakeTransport(unknown());
    const client = makeClient(transport, {}, { retryNotSent: 3 });
    await expect(client.utilityQuery({ transid: "T1" })).rejects.toMatchObject({
      classification: "UNKNOWN_OUTCOME",
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("wraps an unclassified transport failure as UNKNOWN_OUTCOME, never as a gateway response", async () => {
    const client = makeClient(new FakeTransport(new Error("boom")));
    await expect(client.utilityPayment(payment)).rejects.toMatchObject({
      classification: "UNKNOWN_OUTCOME",
    });
  });
});

describe("validation happens before anything is signed or sent", () => {
  it("rejects fractional, zero and unsafe amounts", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport);
    for (const amount of [8000.5, 0, -1, 2 ** 60, Number.NaN]) {
      await expect(client.createOrderMinimal({ ...order, amount })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(transport.requests).toHaveLength(0);
  });

  it("makes the currency explicit and TZS-only for payouts", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport);
    await expect(
      client.createOrderMinimal({ ...order, currency: undefined as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.createOrderMinimal({ ...order, currency: "EUR" as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.walletCashIn({
        transid: "T1",
        utilityCode: "CASHIN",
        utilityRef: "255700000002",
        amount: 1000,
        currency: "USD" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(transport.requests).toHaveLength(0);
  });

  it("does not invent buyer data: missing required fields raise", async () => {
    const client = makeClient(new FakeTransport(reply(200, ok)));
    await expect(client.createOrderMinimal({ ...order, buyerEmail: "" })).rejects.toThrow(
      /buyerEmail/,
    );
    await expect(
      client.createOrderMinimal({ ...order, buyerPhone: undefined as never }),
    ).rejects.toThrow(/buyerPhone/);
  });

  it("rejects a malformed date range", async () => {
    const client = makeClient(new FakeTransport(reply(200, ok)));
    await expect(
      client.listOrders({ fromDate: "21/11/2026", toDate: "2026-11-21" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("surfaces a signing error and sends nothing", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const client = makeClient(transport, { timestampOffsetMinutes: 99999 });
    await expect(client.orderStatus({ orderId: "ORD-1" })).rejects.toBeInstanceOf(SigningError);
    expect(transport.requests).toHaveLength(0);
  });
});

describe("execute and operations", () => {
  it("runs an operation spec directly", async () => {
    const transport = new FakeTransport(reply(200, ok));
    const r = await makeClient(transport).execute(operations.orderStatus, { orderId: "ORD-1" });
    expect(r.status).toBe("NOT_FOUND"); // 000 with empty data: the order does not exist
    expect(operations.vendorBalance.name).toBe("vendor.balance");
  });
});

describe("results and errors never print personal data by default", () => {
  const body = {
    ...ok,
    data: [
      {
        card_token: "CARDTOKEN-TEST-0001",
        name: "Test Buyer",
        masked_card: "4111",
        phone: "255700000001",
      },
    ],
  };

  it("console.log / util.inspect of a result is the redacted form", async () => {
    const r = await makeClient(new FakeTransport(reply(200, body))).storedCards({
      gatewayBuyerUuid: "G",
      buyerUserId: "U",
    });
    const shown = inspect(r, { depth: 6 });
    for (const secret of ["CARDTOKEN-TEST-0001", "Test Buyer", "255700000001"]) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain("[REDACTED]");
  });

  it("raw and body are non-enumerable but still readable", async () => {
    const r = await makeClient(new FakeTransport(reply(200, body))).storedCards({
      gatewayBuyerUuid: "G",
      buyerUserId: "U",
    });
    expect(Object.keys(r)).not.toContain("raw");
    expect(Object.keys(r)).not.toContain("body");
    expect(JSON.stringify({ ...r })).not.toContain("CARDTOKEN-TEST-0001");
    expect(r.raw).toContain("CARDTOKEN-TEST-0001");
    expect(r.body?.resultcode).toBe("000");
  });

  it("an InvalidResponseError does not print the body, but carries it", async () => {
    const error = await makeClient(
      new FakeTransport(reply(502, "<html>Test Buyer 255700000001</html>")),
    )
      .listOrders({ fromDate: "2026-11-01", toDate: "2026-11-02" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidResponseError);
    const e = error as InvalidResponseError;
    expect(Object.keys(e)).not.toContain("raw");
    expect(inspect(e)).not.toContain("255700000001");
    expect(e.raw).toContain("255700000001");
    expect(e.httpStatus).toBe(502);
  });
});
