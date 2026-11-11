# Team sync implementation status — incomplete

This branch is a work in progress. Do not deploy the SQL migrations, use the team-sync UI with real credentials, or treat the feature as complete.

## Safety gate

- `src/lib/server/team-remote.ts` blocks connection before network access, and the legacy bulk sync endpoint fails closed. These are temporary safety gates, not a finished feature.
- The current local application uses demo personas and a single daemon database. It does not enforce authenticated local user/leader ownership on run GET/list/edit/export. Therefore importing team-private handovers would permit other local personas to see them. Do not enable synchronization until this is fixed and tested.
- The isolated PGlite SQL harness now passes 20 authorization tests after fixing named RPC arguments, savepoint handling, nested secret-key rejection, and direct access to the chain-owner helper. This does not verify deployment against Supabase, local route authorization, or all policy attacks.
- Added isolated, currently UNWIRED foundations: provider-backed identity verification and membership checks, expiring/revocable per-user opaque sessions, atomic private-run ownership, and owner/lead authorization helpers. Their focused tests pass, but existing daemon and Next routes do not call these helpers yet; do not infer application-level protection from unit tests.
- Latest isolated run: 38 tests passed across the SQL policy, provider identity, membership, session and ownership suites; five future sync tests skipped. Extension bridge tests: 28 passed in isolation. These are fixture-level checks, not live Supabase or end-to-end login verification.
- Existing tests/team-sync-engine.test.ts holds five skipped future sync tests; one fail-closed test is enabled. A previous draft passed five mocked transport tests before the security gates were added; that does not establish production safety.
- Existing pre-team-sync baseline is branch `integration/team-handover` commit `0a97865`; untouched original checkout is `/home/fev/GitRepos/ReV`.

## Remaining engineering work

1. Implement real per-user local authentication and authorization for all existing daemon and web UI routes, including direct run APIs and the VS Code host. Ensure a lead can read permitted handovers, an owner cannot be impersonated, and unshared local runs stay private on the machine.
2. Extend remote RLS/invitation/payload tests as actual SQL under multiple identities. Reconcile stable owner semantics across revisions, enforce least privilege, protect every access path, and verify against a disposable Supabase instance when available.
3. Implement user sign-in and leader team creation/member onboarding without exchanging access tokens via chat or storing credentials in browser localStorage. Add JWT refresh or clearly handle expiration.
4. Finish sync: secure per-user visibility (private vs share with lead), two-way pull, persisted pending state, exact preview/consent with provenance, concurrent edit handling and usable conflict resolution. Avoid overwriting local data if remote imports have fewer/unselected source records; retain events and versions.
5. Make shared committed-code cache use stable repository identity and verified analyzer/version/scope, with correct path/privacy filtering, sharing opt-in and per-team scoped reuse. Prove cache hit skips an analyzer and negatives reanalyze.
6. Connect the shared dashboard/VS Code React UI to the real service, replacing demo role assumptions and verifying all existing handover/review/source flows. Implement the selected-project-to-wizard run path and ensure `projectRoot` attribution is real.
7. Review old bulk sync, export, raw source data, membership provisioning, revocation, stale previews, retry/idempotency, offline recovery, conflicting writes, and remote authorization. Do not silently drop previous features or delete data.
8. Run isolated full unit+Rust+build tests, real role-aware multi-client integration tests, and browser/VS Code interaction tests. The last attempt at Chromium inside the restricted bubblewrap sandbox exited with SIGTRAP before browser startup; no live Supabase test has run.
