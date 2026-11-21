import { describe, expect, it } from "vitest";
import {
  AmountError,
  classify,
  classifyPaymentStatus,
  maskEmail,
  maskName,
  maskPhone,
  normalizeResultCode,
  parseAmount,
  redactBody,
  redactBodyText,
  redactHeaders,
  redactOptionsForUrl,
  redactQuery,
  redactUrl,
  redactValue,
} from "../src/index.js";

describe("redaction", () => {
  it("masks phone numbers to the last 4 digits", () => {
    expect(maskPhone("255700000001")).toBe("********0001");
    expect(maskPhone("123")).toBe("***");
    expect(redactValue("msisdn", "255700000001")).toBe("********0001");
    expect(redactValue("phone", 255700000001)).toBe("********0001");
    expect(redactValue("buyer_phone", "255700000001")).toBe("********0001");
  });

  it("masks e-mail and names", () => {
    expect(maskEmail("test@example.com")).toBe("t***@example.com");
    expect(maskEmail("nonsense")).toBe("[REDACTED]");
    expect(maskName("Test")).toBe("T***");
    expect(redactValue("buyer_email", "test@example.com")).toBe("t***@example.com");
    expect(redactValue("buyer_name", "Test Buyer")).toBe("T***");
    expect(redactValue("lastname", "Buyer")).toBe("B***");
  });

  it("replaces secrets entirely, whatever their case", () => {
    for (const k of ["pin", "secret", "api_secret", "Authorization", "DIGEST", "card_token"]) {
      expect(redactValue(k, "value")).toBe("[REDACTED]");
    }
  });

  it("treats billing. and shipping. forms like the plain field", () => {
    expect(redactValue("billing.phone", "255700000001")).toBe("********0001");
    expect(redactValue("shipping.firstname", "Test")).toBe("T***");
  });

  it("treats utilityref as a phone only when told to (wallet cash-in)", () => {
    expect(redactValue("utilityref", "255700000002")).toBe("255700000002");
    expect(redactValue("utilityref", "255700000002", { utilityrefIsPhone: true })).toBe(
      "********0002",
    );
  });

  it("leaves other fields alone", () => {
    expect(redactValue("order_id", "ORD-1")).toBe("ORD-1");
  });

  it("redacts flat and nested bodies without changing the input", () => {
    const input = {
      pin: "1234",
      billing: { firstname: "Test", phone: "255700000001" },
      "billing.lastname": "Buyer",
      data: [{ card_token: "TOKEN", masked_card: "4111-11XX-XXXX-1111" }],
      amount: 8000,
    };
    const out = redactBody(input) as typeof input;
    expect(out.pin).toBe("[REDACTED]");
    expect(out.billing).toEqual({ firstname: "T***", phone: "********0001" });
    expect(out["billing.lastname"]).toBe("B***");
    expect(out.data[0]).toEqual({ card_token: "[REDACTED]", masked_card: "4111-11XX-XXXX-1111" });
    expect(out.amount).toBe(8000);
    expect(input.pin).toBe("1234");
  });

  it("redacts a JSON text body, and omits a body it cannot parse", () => {
    expect(redactBodyText('{"pin":"1234"}')).toBe('{"pin":"[REDACTED]"}');
    expect(redactBodyText("<html>secret</html>")).not.toContain("secret");
  });

  it("redacts headers and query strings", () => {
    expect(redactHeaders({ Authorization: "SELCOM abc", Digest: "x=", Accept: "a" })).toEqual({
      Authorization: "[REDACTED]",
      Digest: "[REDACTED]",
      Accept: "a",
    });
    expect(redactQuery("order_id=ORD-1&msisdn=255700000001&buyer_email=t%40example.com")).toBe(
      "order_id=ORD-1&msisdn=%2A%2A%2A%2A%2A%2A%2A%2A0001&buyer_email=t%2A%2A%2A%40example.com",
    );
    expect(redactUrl("https://x.example/v1/a?pin=1234")).toBe(
      "https://x.example/v1/a?pin=%5BREDACTED%5D",
    );
    expect(redactUrl("https://x.example/v1/a")).toBe("https://x.example/v1/a");
  });
});

describe("utilityref by path", () => {
  it("is a phone on walletcashin paths only", () => {
    expect(redactOptionsForUrl("https://h/v1/walletcashin/process").utilityrefIsPhone).toBe(true);
    expect(redactOptionsForUrl("https://h/v1/walletcashin/query?x=1").utilityrefIsPhone).toBe(true);
    expect(
      redactOptionsForUrl("https://h/v1/utilitypayment/process").utilityrefIsPhone,
    ).toBeUndefined();
    expect(
      redactOptionsForUrl("https://h/v1/utilitypayment/lookup?next=/v1/walletcashin/")
        .utilityrefIsPhone,
    ).toBeUndefined();
  });

  it("redactUrl masks it automatically on walletcashin URLs", () => {
    expect(
      redactUrl("https://h/v1/walletcashin/namelookup?utilitycode=CASHIN&utilityref=255700000002"),
    ).toBe(
      "https://h/v1/walletcashin/namelookup?utilitycode=CASHIN&utilityref=%2A%2A%2A%2A%2A%2A%2A%2A0002",
    );
    expect(redactUrl("https://h/v1/utilitypayment/lookup?utilityref=0123456")).toContain(
      "utilityref=0123456",
    );
  });
});

describe("amounts", () => {
  it("parses whole amounts, with or without thousands separators", () => {
    expect(parseAmount("10000")).toBe(10000);
    expect(parseAmount("10,000")).toBe(10000);
    expect(parseAmount("1,250,000")).toBe(1250000);
    expect(parseAmount(" 5000 ")).toBe(5000);
    expect(parseAmount("10000.00")).toBe(10000);
    expect(parseAmount(5000)).toBe(5000);
  });

  it("rejects everything else", () => {
    for (const bad of [
      "10.50",
      "10,00",
      "1,2345",
      "-5",
      "1e3",
      "",
      "abc",
      "10 000",
      "9007199254740993",
    ]) {
      expect(() => parseAmount(bad), bad).toThrow(AmountError);
    }
    expect(() => parseAmount(1.5)).toThrow(AmountError);
    expect(() => parseAmount(-1)).toThrow(AmountError);
  });
});

describe("classification rules", () => {
  it("normalises result codes", () => {
    expect(normalizeResultCode(" 000 ")).toBe("000");
    expect(normalizeResultCode(0)).toBe("000");
    expect(normalizeResultCode(111)).toBe("111");
    expect(normalizeResultCode("")).toBeUndefined();
    expect(normalizeResultCode(null)).toBeUndefined();
    expect(normalizeResultCode(true)).toBeUndefined();
  });

  it("maps payment_status case-insensitively", () => {
    expect(classifyPaymentStatus(" completed ")).toBe("SUCCESS");
    expect(classifyPaymentStatus("COMPLETE")).toBe("SUCCESS");
    expect(classifyPaymentStatus("INPROGRESS")).toBe("PENDING");
    for (const s of [
      "CANCELLED",
      "canceled",
      "CANCEL",
      "USERCANCELLED",
      "USERCANCELED",
      "REJECTED",
      "FAILED",
    ]) {
      expect(classifyPaymentStatus(s)).toBe("FAILED");
    }
    expect(classifyPaymentStatus("???")).toBe("AMBIGUOUS");
    expect(classifyPaymentStatus(undefined)).toBe("AMBIGUOUS");
  });

  it("a 404 from a non-status operation is an ordinary failure, not NOT_FOUND", () => {
    const body = JSON.stringify({ resultcode: "404", data: [] });
    expect(classify("other", 200, body).status).toBe("FAILED");
    expect(classify("payment", 200, body).status).toBe("FAILED");
    expect(classify("status-query", 200, body).status).toBe("NOT_FOUND");
  });

  it("order-status: empty data is NOT_FOUND, missing data is AMBIGUOUS", () => {
    expect(classify("order-status", 200, '{"resultcode":"000","data":[]}').status).toBe(
      "NOT_FOUND",
    );
    expect(classify("order-status", 200, '{"resultcode":"000"}').status).toBe("AMBIGUOUS");
    expect(classify("order-status", 200, '{"resultcode":"000","data":{}}').status).toBe(
      "AMBIGUOUS",
    );
    expect(classify("order-status", 200, '{"resultcode":"400"}').status).toBe("AMBIGUOUS");
  });

  it("a response with no verdict is AMBIGUOUS for money kinds and an error for other", () => {
    expect(classify("payment", 502, "<html/>").status).toBe("AMBIGUOUS");
    expect(classify("payment", 200, "[]").status).toBe("AMBIGUOUS");
    expect(classify("status-query", 200, '{"resultcode":""}').status).toBe("AMBIGUOUS");
    expect(() => classify("other", 502, "")).toThrow(/no usable resultcode/);
  });
});
