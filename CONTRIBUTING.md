# Contributing

Thanks for helping. This is an independent community client, not affiliated with Selcom Paytech Ltd.

## The spec comes first

Signing, results, webhooks and client behaviour are defined in [selcom-spec](https://github.com/selcom-developers/selcom-spec). If this client and the spec disagree, the client is wrong, or the spec needs a fix that every client then picks up. Open the spec change first, then refresh the vectors here:

```sh
npm run sync-vectors -- <spec-tag>
```

This replaces `tests/vectors` and rewrites `SPEC_VERSION`. Never edit the vectors by hand.

## Workflow

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

- Open a pull request against `main` from a feature branch. CI must be green (Node 20, 22 and 24).
- Use `npm run format` to apply Biome's formatting.
- Add or update tests with every behaviour change. Tests never touch the network; the sandbox test is opt-in.
- Keep the package free of runtime dependencies.
- Update the Unreleased section of `CHANGELOG.md`.

## Ground rules

- **Clean room.** Write your own code. Do not copy from Selcom's official clients or from other Selcom client libraries; reading them to understand behaviour is fine.
- **Never retry payments or writes** in the client, and never turn a transport error into a gateway result.
- **No secrets or real data** anywhere in the repository, tests, issues or pull requests: use made-up values (`2557000000xx` phone numbers, `ORD-1001`, `test-key-0001`) or the sample values in Selcom's public documentation.
- Do not log the secret, PIN, `Authorization` or `Digest`.
- Releasing and publishing are done by the maintainers.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
