# @selcom-developers/selcom

Community TypeScript/Node client for the Selcom API gateway: request signing, checkout, payouts and webhooks. Zero runtime dependencies. Apache-2.0.

> **Not affiliated with Selcom Paytech Ltd.** This is an independent community project. For API access, credentials, contracts and support, go to Selcom: <https://developers.selcommobile.com/>. Where this README and Selcom's portal disagree about the API itself, the portal wins.

> **Version 0.1.0.** Install it as `@selcom-developers/selcom` (see below). The API may still change before 1.0.

Written from scratch against the shared [selcom-spec](https://github.com/selcom-developers/selcom-spec) (tag in [`SPEC_VERSION`](SPEC_VERSION)). The spec is the source of truth for signing, results and webhooks; this package passes every one of its test vectors.

## Design in one paragraph

Every layer is usable on its own and replaceable: the **signer** is a pure function (no I/O, no clock), the **transport** is an interface you can swap (proxy, logging, your own HTTP client, a test fake), **operations** are plain specs you can run through `client.execute`, **results** carry the typed status plus the raw HTTP status and body, and **webhook verification** is a separate object. Nothing retries a payment or a write, ever.

## Install and requirements

- Node 20 or later (CI runs 20, 22 and 24). It uses the global `fetch` and `node:crypto`; there are no runtime dependencies.
- ESM and CommonJS are both supported, with type declarations.

```sh
npm install @selcom-developers/selcom
```

## Quickstart

```ts
import { SelcomClient } from "@selcom-developers/selcom";

const selcom = new SelcomClient({
  config: {
    environment: "sandbox", // required: "sandbox" or "production", there is no default
    apiKey: process.env.SELCOM_API_KEY!,
    secret: process.env.SELCOM_API_SECRET!,
    vendor: process.env.SELCOM_VENDOR!,
  },
});

// 1. Create an order (non-card), 2. push a USSD prompt to the buyer's wallet.
const order = await selcom.createOrderMinimal({
  orderId: "ORD-1001",
  buyerEmail: "buyer@example.com",
  buyerName: "Test Buyer",
  buyerPhone: "255700000001",
  amount: 8000, // whole units; fractions are rejected, never rounded
  currency: "TZS", // always explicit
  noOfItems: 1,
  webhookUrl: "https://example.com/selcom/webhook/<random-token>",
});

const push = await selcom.walletPayment({
  transid: "TXN-1001",
  orderId: "ORD-1001",
  msisdn: "255700000001",
});
// push.status is normally "PENDING": the outcome arrives by webhook and is confirmed with orderStatus.
```

## Configuration

```ts
new SelcomClient({
  config: {
    environment: "sandbox" | "production" | "custom", // required
    baseUrl: "https://simulator.example.com",          // only with environment "custom"
    apiKey, secret, vendor,
    pin,                                               // float PIN: needed by payout operations only
    checkout: { apiKey, secret },                      // optional separate credentials for checkout.*
    timeouts: { query: { connectMs, readMs }, moneyMoving: { connectMs, readMs } },
    retryNotSent: 0,                                   // opt-in, read-only operations only (see below)
  },
  transport,                // replace the HTTP layer
  fetch,                    // or just your own fetch for the default transport
  clock: () => new Date(),  // source of the Timestamp header
  timestampOffsetMinutes: 180, // default +03:00 (Africa/Dar_es_Salaam)
  signer: (credentials) => hs256Signer(credentials.secret), // swap the digest step (RS256 later)
});
```

- **The environment is explicit.** A missing or unknown value is an error at construction, and there is no production default. Presets: sandbox `https://apigwtest.selcommobile.com`, production `https://apigw.selcommobile.com`. A custom base URL (a simulator or proxy) must be its own choice, `environment: "custom"`, and must be https (http only for localhost).
- A missing key, secret or vendor fails at construction, not on the first request. The secret and PIN never appear in `toString`, `JSON.stringify`, `util.inspect` or error messages.
- **Timeouts** per profile. Defaults: `query` 10 s connect / 10 s read; `moneyMoving` 15 s connect / 180 s read. The long payment read timeout is deliberate: timing out early does not stop the payment, it only turns a known answer into an unknown one. The default transport uses `fetch`, which cannot separate connecting from waiting, so the wait for response headers is bounded by connect + read.

## Operations

One method per operation. Each returns an `OperationResult` and takes `{ signal }` as an optional second argument. Request fields are camelCase; the client builds the spec's wire names, flattens nested groups, and base64-encodes URL fields for you.

| Method | Spec operation | Kind |
|---|---|---|
| `createOrder` | `checkout.create-order` | write |
| `createOrderMinimal` | `checkout.create-order-minimal` | write |
| `walletPayment` | `checkout.wallet-payment` | payment |
| `cardPayment` | `checkout.card-payment` | payment |
| `orderStatus` | `checkout.order-status` | order-status |
| `cancelOrder` | `checkout.cancel-order` | write |
| `listOrders` | `checkout.list-orders` | read |
| `storedCards` | `checkout.stored-cards` | read |
| `deleteCard` | `checkout.delete-card` | write |
| `utilityPayment` | `utilitypayment.process` | payment |
| `utilityLookup` | `utilitypayment.lookup` | read |
| `utilityQuery` | `utilitypayment.query` | status-query |
| `walletCashIn` | `walletcashin.process` | payment |
| `walletNameLookup` | `walletcashin.namelookup` | read |
| `walletCashInQuery` | `walletcashin.query` | status-query |
| `vendorBalance` | `vendor.balance` | read |

Submitting and querying are separate methods: nothing hides a query inside a submit. The same operations are available as specs: `client.execute(operations.orderStatus, { orderId })`.

Amounts are whole units of an explicit currency (a safe integer; never a float). Checkout takes `TZS` or `USD`; payouts are TZS only and refuse anything else. The client never invents buyer data: a missing required field raises `ValidationError`, before anything is signed or sent.

```ts
// Payout from the float (needs `pin` in the config)
const pay = await selcom.utilityPayment({
  transid: "TXN-UTL-0001",
  utilityCode: "LUKU",
  utilityRef: "01234567890",
  amount: 5000,
});

const balance = await selcom.vendorBalance({ transid: "TXN-BAL-0001" });
balance.data[0]?.balanceTzs; // 1000000
```

## Results

Every operation returns the same shape:

| Field | Content |
|---|---|
| `status` | `SUCCESS`, `PENDING`, `AMBIGUOUS`, `FAILED` or `NOT_FOUND` |
| `resultcode` | The normalised code, or `undefined` when the response carried no verdict |
| `result`, `message`, `reference` | The gateway's text, unchanged |
| `transid` / `orderId` | The ID this result is about |
| `httpStatus` | The raw HTTP status |
| `data` | Typed entries (base64 URLs decoded; raw values kept in `body`) |
| `body` | The parsed envelope, every raw value |
| `raw` | The raw response body, for audit |

`result.isFinal()` is true for `SUCCESS`, `FAILED` and `NOT_FOUND`. `JSON.stringify(result)` and `result.redacted()` mask personal data; `raw` and `body` themselves are unredacted, so redact before you log them.

The verdict comes from `resultcode` only: `000` is `SUCCESS`; `111` and `927` are `PENDING`; `999` is `AMBIGUOUS`; `404` on a status query or order status is `NOT_FOUND`; anything else is `FAILED`. The HTTP status and the `result` text never decide it. A response with no verdict is `AMBIGUOUS` for payments, status queries and order status (the money may have moved) and throws `InvalidResponseError` for the rest. For `orderStatus` the verdict is `data[0].payment_status` (see the spec's results.md). Use `classify(kind, httpStatus, rawBody)` on its own if you hold the response yourself.

| Status | Meaning | What you may do |
|---|---|---|
| `SUCCESS` | It happened | Fulfil, after confirming |
| `PENDING` | Accepted, still processing | Wait for the webhook, or query after 3 minutes or more |
| `AMBIGUOUS` | Nobody knows yet | Query after 3 minutes or more. Never resubmit |
| `FAILED` | It did not happen | Report it. A new attempt is a new transaction with a new ID, and your decision |
| `NOT_FOUND` | The gateway has no record of the ID | The only case in which the same ID may be submitted again |

## Error handling

| Thrown | When | Meaning |
|---|---|---|
| `ConfigError` | Bad configuration, or a payout without a PIN | Nothing was sent |
| `ValidationError` | A request field is missing or invalid | Nothing was sent |
| `SigningError` | The signer refused its input (`code` matches the spec's reject codes) | Nothing was sent. The client never sends an empty `Digest` |
| `TransportError` | No HTTP response arrived | See `classification` below |
| `InvalidResponseError` | A response with no verdict, on an operation where that is an error | Carries `httpStatus` and `raw` |

A `TransportError` says which of two things happened, and is never disguised as a gateway response or as `FAILED`:

- `NOT_SENT`: DNS failure, refused connection, connect timeout, TLS handshake failure. The request provably never reached the gateway; sending it again with the same ID is safe.
- `UNKNOWN_OUTCOME`: anything after the request may have been written (read timeout, reset, truncated response). Treat it as `AMBIGUOUS`: query, never resend. If the HTTP stack cannot tell, the answer is `UNKNOWN_OUTCOME`.

**No automatic retry of payments or writes**, whatever the error. If you pass your own `fetch` or transport, it must not retry or resend a POST on its own either (no retry interceptor or middleware); the default transport also never follows redirects. Writes are create-order, create-order-minimal, cancel-order and delete-card. For read-only operations you may opt in with `retryNotSent: n`: the client then repeats a call after a `NOT_SENT` error only, with the same parameters and a fresh timestamp.

## Idempotency and reconciliation

The ID is the idempotency key: `transid` identifies a payout or payment attempt, `order_id` a checkout order. The gateway refuses a second transaction with an ID it has seen. The client is stateless: it does not lock, queue or deduplicate. That part is yours:

1. **Generate IDs deterministically** from your own records (for example `"TXN-" + payoutRow.id`), so a crash and restart produces the same ID, not a new one. Keep them to 30 characters or fewer, using `A-Z a-z 0-9 -` (the gateway has not published its limits).
2. **Persist the ID with a "submitting" state before you call the gateway.** After a crash, reconcile anything left in that state by querying.
3. **Put a unique constraint on the ID**, so a retried job cannot create a second transaction.
4. **Settle `PENDING` and `AMBIGUOUS` by querying**: wait at least 3 minutes after the request, query with the same ID (`utilityQuery` or `walletCashInQuery` by `transid`; `orderStatus` by `orderId` for checkout), and repeat every 3 minutes for a window you choose. If it never settles, hand it to a person with the `transid` and `reference`.
5. **Never mint a new ID while an outcome is unknown.** Use a new one only after the old one is `FAILED`. Resubmit the same ID only after `NOT_FOUND`.
6. **Apply results under a row lock or with a compare-and-set**, behind a final-state guard: `SUCCESS` and a cancel-confirmed `FAILED` are final; a later conflicting result is ignored and flagged for a person.
7. An `orderStatus` of `FAILED` describes the latest attempt only; an unexpired order can still be paid. To close an order as failed for good, `cancelOrder` it: a completed order cannot be cancelled, so a successful cancel proves it was never paid.

## Webhooks

A webhook is a hint, not proof: never fulfil an order because a webhook said so. Confirm with `orderStatus` first, every time.

```ts
import { createWebhookVerifier, parseWebhook, webhookResponse } from "@selcom-developers/selcom";

const webhooks = createWebhookVerifier({
  secret: process.env.SELCOM_API_SECRET!,
  windowSeconds: 300,            // default 300, either side of now
  // replayStore: new RedisReplayStore(...)  // default: in-memory; implement ReplayStore for several instances
});

// Express-style handler. `req.body` must be the RAW body (Buffer or string), not parsed JSON.
// Verify, store the delivery, and only then acknowledge. Confirming with orderStatus and
// fulfilling happen later, outside the request (a queue or a background job).
app.post("/selcom/webhook/:token", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const verdict = await webhooks.verify(req.headers, req.body);
    const { httpStatus, process } = webhookResponse(verdict);
    if (process) {
      const payload = parseWebhook(req.body); // hints only; amountUnparsed flags a bad amount
      // Store the delivery, deduplicated on (payload.orderId, payload.transid): the raw body with
      // personal data redacted, the headers minus Authorization and Digest, the verdict, the time.
      await saveDelivery({ payload, verdict }); // your code; throws if storing fails
      // Later, in a job: const confirmed = await selcom.orderStatus({ orderId: payload.orderId! });
      // and act only on `confirmed`, the amount included, behind your final-state guard.
    }
    res.sendStatus(httpStatus);
  } catch {
    // Storing failed (or the body was unreadable): a 5xx makes the gateway try again.
    res.sendStatus(500);
  }
});
```

`verify(headers, rawBody)` accepts the raw body as a string or a Buffer and headers as a plain object, a `Map` or a `Headers`. Verdicts:

| Verdict | Respond | Process? |
|---|---|---|
| `VALID` | 200 | Yes, then confirm with `orderStatus` |
| `UNSIGNED` | 200 | Yes, then confirm with `orderStatus` |
| `REPLAY` | 200 | No: it has been handled |
| `INVALID` | 401 | No. Log it, redacted |
| `STALE` | 401 | No. Log it, redacted |

`VALID` vouches only for the fields named in `Signed-Fields`. `amount` is not one of them, so take the amount from `orderStatus`. Which key Selcom signs webhooks with is an open question in the spec (the samples assume your API secret). To find out in the sandbox, run in report-only mode: log the verdict, never reject. The verifier returns a verdict and never rejects anything itself. If your `ReplayStore` fails, `verify` raises `ReplayStoreError` instead of a verdict: answer with a 5xx (the handler above does) so the gateway delivers again. `parseWebhook` turns `amount` (`"10,000"`) into whole units (`amountTzs`) and ignores fields it does not know. `amount` is not signed, so a bad one never throws: you get `amountTzs: undefined` and `amountUnparsed: true`.

## Signing on its own

The signer is a pure function: no I/O, no clock. Use it with any HTTP client.

```ts
import { formatTimestamp, hs256Signer, signRequest } from "@selcom-developers/selcom";

const signed = signRequest({
  method: "POST",
  params: new Map([ // order is the caller's order; a Map or an array of pairs keeps it exactly
    ["vendor", "TILL123"],
    ["order_id", "ORD-1001"],
    ["amount", 8000],
    ["billing", { firstname: "John" }], // flattened in place to billing.firstname
  ]),
  timestamp: formatTimestamp(new Date()), // yyyy-MM-ddTHH:mm:ss+03:00
  apiKey,
  signer: hs256Signer(secret),
});
signed.headers; // Authorization, Digest-Method, Digest, Timestamp, Signed-Fields, Accept, Content-Type
signed.body;    // flat JSON for POST; signed.query for GET and DELETE
```

It rejects (with a `SigningError`) an empty secret or key, fractional or oversized numbers, arrays, empty objects, bad or duplicate keys, empty parameters and malformed timestamps. A plain object is accepted too, but JavaScript moves integer-like keys such as `"23"` to the front; use a `Map` or pairs when order matters.

## Replacing the transport

```ts
import { createFetchTransport, loggingTransport, type Transport } from "@selcom-developers/selcom";

// Your own fetch (for example with a proxy dispatcher):
new SelcomClient({ config, fetch: myFetch });

// Safe logging: secrets, PINs, Authorization, Digest and personal data are redacted.
new SelcomClient({ config, transport: loggingTransport(createFetchTransport(), console.log) });

// Or implement the interface: resolve with a response for ANY HTTP status; throw a
// TransportError ("NOT_SENT" or "UNKNOWN_OUTCOME") when there is no response.
const transport: Transport = { async send(request) { /* ... */ } };
```

## Security

- **Never log the secret, the PIN, `Authorization` or `Digest`.** Use the redaction helpers (`redactHeaders`, `redactBody`, `redactBodyText`, `redactQuery`, `redactUrl`) for anything you store or log. They mask phone numbers (`********0001`), e-mail (`t***@example.com`), names (`T***`), and replace secrets and `card_token` with `[REDACTED]`. `utilityref` is masked automatically on `/v1/walletcashin/` URLs (`redactUrl`, `loggingTransport`); with the body helpers on their own, pass `{ utilityrefIsPhone: true }` for wallet cash-in. Results and errors print redacted (`console.log(result)`), and their `raw` and `body` are non-enumerable.
- Card tokens from `storedCards` are sensitive: never log them in full.
- Keep credentials in environment variables or a secret manager, never in the repository.
- Compare digests in constant time (the verifier does).
- Keep the host clock synchronised: the gateway rejects requests whose time is too far from its own, and webhook verification uses a time window.
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run lint        # Biome
npm run typecheck
npm test            # Vitest: every spec vector, no network
npm run build       # tsup: ESM + CJS + .d.ts into dist/
npm run sync-vectors -- v0.2.1   # refresh tests/vectors from selcom-spec at a tag; updates SPEC_VERSION
```

An opt-in sandbox test (`tests/sandbox.test.ts`) runs only when `SELCOM_SANDBOX_API_KEY`, `SELCOM_SANDBOX_SECRET` and `SELCOM_SANDBOX_VENDOR` are set. It makes one read-only call. It never runs by default or in CI.

See [CONTRIBUTING.md](CONTRIBUTING.md). The rules this client follows are in the [selcom-spec](https://github.com/selcom-developers/selcom-spec) repository: `docs/signing.md`, `docs/api-v1.md`, `docs/results.md`, `docs/webhooks.md` and `docs/client-requirements.md`.

## License

[Apache License 2.0](LICENSE). Not affiliated with Selcom Paytech Ltd.
