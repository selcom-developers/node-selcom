# Security policy

This is an independent community client for the Selcom API gateway. It is not affiliated with Selcom Paytech Ltd.

## Reporting a vulnerability in this package

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). If that is not available, open a public issue that says only that you have a security report and asks for a private channel, without any details.

Include the version, a description of the impact, and steps to reproduce using made-up data. Never send real credentials, PINs or customer data.

You can expect an acknowledgement within a few days. This is a community project maintained on a best-effort basis.

## Scope

In scope: request signing, webhook verification, secret or personal-data leaks through logs or errors, unsafe retry behaviour, and the build and CI configuration.

Out of scope: vulnerabilities in Selcom's gateway or services (report them to Selcom through its developer portal at <https://developers.selcommobile.com/>), and in your own application.

## Guidance for users

- Keep the API secret and float PIN in environment variables or a secret manager.
- Never log the secret, PIN, `Authorization` or `Digest`; use the redaction helpers for anything you store or log.
- Verify webhooks and still confirm every order with `orderStatus` before fulfilling.
- Keep the host clock synchronised.
- Report credentials you have exposed to Selcom so they can be rotated.
