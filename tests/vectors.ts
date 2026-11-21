import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "vectors");

export function loadJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(dir, ...parts), "utf8")) as T;
}

export function listResponseFiles(): string[] {
  return readdirSync(join(dir, "responses"))
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export interface SigningCase {
  id: string;
  method: "GET" | "POST" | "DELETE";
  scope: "request" | "signer";
  timestamp: string;
  api_key: string;
  secret: string;
  params: Record<string, unknown>;
  expected: {
    flattened: Array<[string, string | number | boolean]>;
    signed_fields: string;
    signing_string: string;
    digest: string;
    authorization: string;
    digest_method: string;
    query?: string;
    body?: string;
  };
}

export interface SigningReject {
  id: string;
  method: "GET" | "POST" | "DELETE";
  timestamp: string;
  api_key: string;
  secret: string;
  params: Record<string, unknown>;
  error: string;
}

export interface SigningVectors {
  cases: SigningCase[];
  rejects: SigningReject[];
}
