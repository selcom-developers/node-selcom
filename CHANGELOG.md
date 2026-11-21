# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-21

### Changed

- README updates.

## [0.1.0] - 2026-11-21

First version. Built against selcom-spec v0.2.1.

### Added

- Configuration with an explicit environment (`sandbox`, `production` or `custom`), no default, secrets kept out of `toString`, JSON and inspect, and per-profile timeouts.
- A pure HS256 signer with a pluggable `Signer` interface: flattening, value rules, `Signed-Fields`, headers, percent-encoded query and flat JSON body.
- A replaceable `Transport` interface with a default `fetch` implementation, `NOT_SENT` / `UNKNOWN_OUTCOME` classification, and a redacting `loggingTransport`.
- 16 typed operations for checkout, wallet cash-in, utility payments and vendor balance. No automatic retry of payments or writes; opt-in retry of read-only operations after `NOT_SENT`.
- Typed results with the five statuses (`SUCCESS`, `PENDING`, `AMBIGUOUS`, `FAILED`, `NOT_FOUND`), the raw HTTP status, body and decoded data.
- Webhook verification (`VALID`, `UNSIGNED`, `REPLAY`, `INVALID`, `STALE`) with a configurable window and replay store, and payload parsing with strict amount parsing.
- Redaction helpers for headers, bodies, query strings and URLs.
- Tests over every case and reject in `vectors/signing.json`, every scenario in `vectors/responses/`, and every webhook sample, from a copy of the spec vectors (`SPEC_VERSION`, `npm run sync-vectors`).
- CI on Node 20, 22 and 24: lint, typecheck, test, build, and a package exports check.

### Changed (during review, before release)

- Transport: only handshake and certificate failures, DNS, refused connections and connect-phase `ENETUNREACH`/`EHOSTUNREACH` are `NOT_SENT`. Other TLS errors (for example `ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC`) are `UNKNOWN_OUTCOME`.
- `parseWebhook` never throws on `amount` (it is unsigned): `amountTzs` is `undefined` and `amountUnparsed` is `true`.
- Results and errors print redacted under `console.log`; `raw`, `body` and `data` are non-enumerable.
- `utilityref` is masked automatically on `/v1/walletcashin/` URLs; redaction also matches typed camelCase fields.
- CI: actions pinned to commit SHAs; a job checks `tests/vectors` is byte-identical to selcom-spec at the `SPEC_VERSION` tag.
- Webhook verify never throws (any failure is `INVALID`), rejects bodies over 1 MiB before hashing, and the replay store keeps a digest until max(now, signed timestamp) + window (`ReplayStore.seen(digest, nowMs, expiresAtMs)`).
- `SelcomConfig` prints the API key as its last 4 characters.
- Adopt spec 0.2.1 webhook rules (steps 4, 5, 6 and 9): required signed fields, cheap bounded number handling, `&` check, replay expiry. Vectors refreshed to selcom-spec v0.2.1.
- Only handshake and certificate failures are `NOT_SENT` among TLS errors; other TLS codes (including `ERR_SSL_WRONG_VERSION_NUMBER`) are `UNKNOWN_OUTCOME`.

[Unreleased]: https://github.com/selcom-developers/selcom-node/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/selcom-developers/selcom-node/releases/tag/v0.1.0
