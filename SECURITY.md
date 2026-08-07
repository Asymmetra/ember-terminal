# Security Policy

## Reporting a vulnerability

Please report security issues privately, **not** through a public issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository: **Security → Report a vulnerability**. That opens a private
advisory visible only to maintainers.

Please include what you were doing, what happened, and — if you have one — a
minimal reproduction. We'll acknowledge within a few days.

## Scope

This is reference software, not a hosted service. The most valuable reports are
ones that would burn someone who forks it and deploys:

- A transaction-building path that produces an instruction set differing from
  what the UI told the user they were signing.
- Anything that could cause a key to be transmitted, logged, or persisted. The
  backend is designed never to hold one — it returns *unsigned* instructions and
  the wallet signs client-side. A break in that boundary is the highest-severity
  class of bug here.
- Missing or bypassable slippage / reduce-only / size validation on an order path.
- CORS, CSP, or WebSocket-origin handling that lets a third-party page drive the
  API with a user's session.
- Dependency vulnerabilities with a plausible exploit path in this codebase.

## Not in scope

- Trading losses, liquidations, or unfavorable fills. This software talks to a
  live market; see the disclaimer in the README.
- The behavior of the Phoenix protocol or the `phoenix-rise` SDK. Report those
  upstream to [Ellipsis Labs](https://github.com/Ellipsis-Labs/rise-public).
- Rate limits or availability of public Solana RPC endpoints.

## If you find a leaked secret

Open a private advisory rather than a public issue, and do not include the
secret value in the report — just the file, commit, and kind of credential.
