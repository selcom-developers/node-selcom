import { describe, expect, it } from "vitest";
import { SelcomClient } from "../src/index.js";

// Opt-in: runs only when the sandbox credentials are present in the environment.
// It makes a read-only call (list-orders) and moves no money. Never runs on forks' pull requests.
const { SELCOM_SANDBOX_API_KEY, SELCOM_SANDBOX_SECRET, SELCOM_SANDBOX_VENDOR } = process.env;
const enabled = Boolean(SELCOM_SANDBOX_API_KEY && SELCOM_SANDBOX_SECRET && SELCOM_SANDBOX_VENDOR);

describe.skipIf(!enabled)("sandbox (opt-in)", () => {
  it("lists today's orders and gets a typed result", async () => {
    const client = new SelcomClient({
      config: {
        environment: "sandbox",
        apiKey: SELCOM_SANDBOX_API_KEY as string,
        secret: SELCOM_SANDBOX_SECRET as string,
        vendor: SELCOM_SANDBOX_VENDOR as string,
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    const result = await client.listOrders({ fromDate: today, toDate: today });
    expect(["SUCCESS", "PENDING", "AMBIGUOUS", "FAILED", "NOT_FOUND"]).toContain(result.status);
    expect(result.httpStatus).toBeGreaterThan(0);
  });
});
