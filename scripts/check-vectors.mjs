#!/usr/bin/env node
// Fails unless tests/vectors is byte-identical to selcom-spec's vectors/ at the tag recorded in
// SPEC_VERSION (and that tag still points at the recorded commit).
// Usage: node scripts/check-vectors.mjs [path-to-local-spec-clone]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = Object.fromEntries(
  readFileSync(join(root, "SPEC_VERSION"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("=")),
);
if (!version.tag || !version.commit) {
  console.error("SPEC_VERSION must contain tag=... and commit=...");
  process.exit(2);
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const list = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(join(dir, e.name), base) : [relative(base, join(dir, e.name))],
  );

let work;
let clone = process.argv[2];
let failed = false;
try {
  if (!clone) {
    work = mkdtempSync(join(tmpdir(), "selcom-spec-"));
    clone = join(work, "spec");
    git(work, "clone", "--quiet", "https://github.com/selcom-developers/selcom-spec.git", clone);
  }
  git(clone, "checkout", "--quiet", version.tag);
  const commit = git(clone, "rev-parse", "HEAD");
  if (commit !== version.commit) {
    console.error(`tag ${version.tag} is ${commit}, SPEC_VERSION records ${version.commit}`);
    failed = true;
  }
  const upstream = join(clone, "vectors");
  const local = join(root, "tests", "vectors");
  const a = new Set(list(upstream));
  const b = new Set(list(local));
  for (const f of new Set([...a, ...b])) {
    if (!a.has(f)) {
      console.error(`only in tests/vectors: ${f}`);
      failed = true;
    } else if (!b.has(f)) {
      console.error(`missing from tests/vectors: ${f}`);
      failed = true;
    } else if (!readFileSync(join(upstream, f)).equals(readFileSync(join(local, f)))) {
      console.error(`differs from selcom-spec ${version.tag}: ${f}`);
      failed = true;
    }
  }
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`tests/vectors is identical to selcom-spec ${version.tag}`);
