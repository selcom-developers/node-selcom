import { describe, expect, it } from "vitest";
import { InvalidResponseError, type OperationResult, type SelcomClient } from "../src/index.js";
import { FakeTransport, makeClient, reply } from "./helpers.js";
import { listResponseFiles, loadJson } from "./vectors.js";

interface Scenario {
  name: string;
  http_status: number;
  body?: unknown;
  raw_body?: string;
  expected_status?: string;
  expected_error?: string;
}

interface ResponseFile {
  operation: string;
  method: string;
  path: string;
  kind: string;
  scenarios: Scenario[];
}

const order = {
  orderId: "ORD-1001",
  buyerEmail: "buyer@example.com",
  buyerName: "Test Buyer",
  buyerPhone: "255700000001",
  amount: 8000,
  currency: "TZS" as const,
  noOfItems: 1,
};
const address = {
  firstName: "Test",
  lastName: "Buyer",
  address1: "1 Test Road",
  city: "Dar es Salaam",
  stateOrRegion: "Dar es Salaam",
  postcodeOrPobox: "00000",
  country: "TZ",
  phone: "255700000001",
};
const payout = {
  transid: "TXN-0001",
  utilityCode: "LUKU",
  utilityRef: "01234567890",
  amount: 5000,
};

/** One valid call per operation in the spec's vectors/responses/. */
const calls: Record<string, (c: SelcomClient) => Promise<OperationResult<unknown>>> = {
  "checkout.create-order": (c) =>
    c.createOrder({ ...order, paymentMethods: ["ALL"], billing: address }),
  "checkout.create-order-minimal": (c) => c.createOrderMinimal(order),
  "checkout.wallet-payment": (c) =>
    c.walletPayment({ transid: "TXN-0001", orderId: "ORD-1001", msisdn: "255700000001" }),
  "checkout.card-payment": (c) =>
    c.cardPayment({
      transid: "TXN-0001",
      orderId: "ORD-1001",
      cardToken: "CARDTOKEN-TEST-0001",
      buyerUserId: "USER-1",
      gatewayBuyerUuid: "GBU-TEST-0001",
    }),
  "checkout.order-status": (c) => c.orderStatus({ orderId: "ORD-1001" }),
  "checkout.cancel-order": (c) => c.cancelOrder({ orderId: "ORD-1001" }),
  "checkout.list-orders": (c) => c.listOrders({ fromDate: "2026-11-01", toDate: "2026-11-21" }),
  "checkout.stored-cards": (c) =>
    c.storedCards({ gatewayBuyerUuid: "GBU-TEST-0001", buyerUserId: "USER-1" }),
  "checkout.delete-card": (c) => c.deleteCard({ id: 23, gatewayBuyerUuid: "GBU-TEST-0001" }),
  "utilitypayment.process": (c) => c.utilityPayment(payout),
  "utilitypayment.lookup": (c) =>
    c.utilityLookup({ utilityCode: "LUKU", utilityRef: "01234567890", transid: "TXN-0001" }),
  "utilitypayment.query": (c) => c.utilityQuery({ transid: "TXN-0001" }),
  "walletcashin.process": (c) =>
    c.walletCashIn({ ...payout, utilityCode: "CASHIN", utilityRef: "255700000002" }),
  "walletcashin.namelookup": (c) =>
    c.walletNameLookup({ utilityCode: "CASHIN", utilityRef: "255700000002", transid: "TXN-0001" }),
  "walletcashin.query": (c) => c.walletCashInQuery({ transid: "TXN-0001" }),
  "vendor.balance": (c) => c.vendorBalance({ transid: "TXN-0001" }),
};

const files = listResponseFiles()
  .map((f) => loadJson<ResponseFile>("responses", f))
  .filter((f) => f.operation !== "checkout.webhook");

describe("response vectors", () => {
  it("covers all 16 operations", () => {
    expect(files.map((f) => f.operation).sort()).toEqual(Object.keys(calls).sort());
  });

  for (const file of files) {
    describe(file.operation, () => {
      const call = calls[file.operation];
      for (const s of file.scenarios) {
        it(s.name, async () => {
          if (!call) throw new Error(`no call for ${file.operation}`);
          const transport = new FakeTransport(
            reply(s.http_status, s.raw_body !== undefined ? s.raw_body : s.body),
          );
          const client = makeClient(transport);

          if (s.expected_error !== undefined) {
            expect(s.expected_error).toBe("INVALID_RESPONSE");
            const error = await call(client).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(InvalidResponseError);
            expect((error as InvalidResponseError).httpStatus).toBe(s.http_status);
          } else {
            const result = await call(client);
            expect(result.status).toBe(s.expected_status);
            expect(result.httpStatus).toBe(s.http_status);
            expect(result.raw).toBe(s.raw_body ?? JSON.stringify(s.body));
          }

          // Whatever the response, exactly one request left, shaped as the spec says.
          expect(transport.requests).toHaveLength(1);
          const sent = transport.requests[0];
          expect(sent?.method).toBe(file.method);
          expect(new URL(sent?.url ?? "").pathname).toBe(file.path);
        });
      }
    });
  }
});
