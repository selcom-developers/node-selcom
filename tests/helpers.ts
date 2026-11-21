import {
  SelcomClient,
  type SelcomClientOptions,
  type SelcomConfigInput,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "../src/index.js";

export const CONFIG: SelcomConfigInput = {
  environment: "sandbox",
  apiKey: "test-key-0001",
  secret: "test-secret-0001",
  vendor: "TILL123",
  pin: "0000",
};

export const FIXED_NOW = new Date("2026-11-21T07:30:46Z"); // 10:30:46 in +03:00

/** A transport that never touches the network: it records requests and replays a response or an error. */
export class FakeTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  readonly #queue: Array<TransportResponse | Error>;

  constructor(...replies: Array<TransportResponse | Error>) {
    this.#queue = replies;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const next = this.#queue.length > 1 ? this.#queue.shift() : this.#queue[0];
    if (next === undefined) throw new Error("FakeTransport has no reply");
    if (next instanceof Error) throw next;
    return next;
  }
}

export function reply(status: number, body: unknown): TransportResponse {
  return {
    status,
    headers: {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export function makeClient(
  transport: Transport,
  overrides: Partial<SelcomClientOptions> = {},
  config: Partial<SelcomConfigInput> = {},
): SelcomClient {
  return new SelcomClient({
    config: { ...CONFIG, ...config },
    transport,
    clock: () => FIXED_NOW,
    ...overrides,
  });
}
