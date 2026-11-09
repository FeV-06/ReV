# Security boundary and threat model (draft)

ReV's current web interface is a **local, single-operator tool**. It has no login, authenticated recipient, source-ACL synchronization or multi-user isolation. Loopback and origin checks do not protect against another process running as the same OS user, malicious browser extensions, a compromised local account or exposure through a reverse proxy. Never deploy the current app to the public internet or treat a recipient label as an identity.

## Data and trust boundaries

1. GitHub API responses, Slack exports, model outputs and reviewer-entered text are untrusted. They may contain instructions, secrets, active markup, corrupt archives or misleading claims.
2. The operator chooses a source scope before generation. The application sends only those selected records to the configured model provider; the operator must authorize remote transmission.
3. Citations are checked for exact source/span matches. This establishes reference integrity only; it does not prove semantic support or truth.
4. Source-scope changes invalidate draft approval. The local operator can still see imported records; this is not recipient authorization. Source redaction creates a separate local snapshot with selected text replaced; it does not delete or restrict the original source. The operator must select the redacted snapshot, not the original, and ensure restricted data is absent from every selected record and its metadata. This is not a substitute for access control.
5. Exported files leave the application's control and cannot be revoked.

## Existing controls and limits

- Loopback binding, same-origin/custom-header checks, bounded JSON/ZIP/model response processing, React escaping and Markdown export escaping are present and covered by selected tests.
- Scope changes and provenance checks are tested with synthetic data. This is not an independent security audit and does not guarantee resistance to prompt injection or all browser/OS attacks.
- API keys belong in local environment configuration, not repository files or logs. Source snapshots and draft content are stored locally in PGLite; protect the OS account and disk.
- `access.ts` contains a **pure, unused prototype** for fail-closed recipient projection. It is not authentication and does not protect any current route. It must not be described as access control until wired into authenticated routes and tested against real source ACLs.

## Required before hosted or multi-user operation

- Define authenticated principals, sessions and workspace membership; protect every read and write route.
- Obtain and periodically revalidate source-specific GitHub/Slack access and revocation for each principal, fail closed on uncertainty.
- Recompute or withhold derived claims, graph edges, metadata and exports if any source access changes; never rely only on visible citations.
- Add isolation tests for two users, mixed-source derivations, stale caches, approval races and revoked access.
- Establish controlled file retention/deletion, auditability, rate/size limits, and a private vulnerability reporting channel.
- Obtain an independent security review with a clearly scoped environment before exposing a hosted service.
