#!/usr/bin/env node
// Refreshes tests/vectors from selcom-spec at a given tag and records it in SPEC_VERSION.
// Usage: node scripts/sync-vectors.mjs <tag> [path-to-local-spec-clone]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
const local = process.argv[3];
if (!tag) {
  console.error("usage: node scripts/sync-vectors.mjs <tag> [path-to-local-spec-clone]");
  process.exit(2);
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

let work;
let clone = local;
try {
  if (!clone) {
    work = mkdtempSync(join(tmpdir(), "selcom-spec-"));
    clone = join(work, "spec");
    git(work, "clone", "--quiet", "https://github.com/selcom-developers/selcom-spec.git", clone);
  }
  git(clone, "checkout", "--quiet", tag);
  const commit = git(clone, "rev-parse", "HEAD");
  const src = join(clone, "vectors");
  if (!existsSync(join(src, "signing.json"))) throw new Error(`no vectors/ at ${tag}`);
  const dest = join(root, "tests", "vectors");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(join(root, "SPEC_VERSION"), `tag=${tag}\ncommit=${commit}\n`);
  console.log(`vectors refreshed from selcom-spec ${tag} (${commit})`);
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
