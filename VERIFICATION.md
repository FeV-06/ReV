# Round 2 MVP verification

> **Historical verification:** This report documents earlier revisions, not the current branch. Some capabilities listed as absent below have since been partially implemented; see `REV_SYSTEMS_CHECKLIST.md` and `SPRINT_HANDOFF.md` for later work. Do not interpret these earlier test results as a fresh verification of the current commit.

**Verdict: runnable local MVP for a Round 2 demonstration; the full original specification is not complete.** The judge needs access to this repository or a packaged copy and their own Node/pnpm/Rust environment. The current app must not be exposed publicly: it is local and single-operator, not an authenticated hosted service.

## Evidence from local execution

- A clean local clone of commit `17b2efe` installed with `pnpm install --frozen-lockfile --ignore-scripts`, built the Rust core, and passed `pnpm verify` (TypeScript, generated-contract check, 18 TypeScript tests, 6 Rust tests and Next.js production build).
- On that fresh clone, two Playwright checks passed: synthetic handover including scope-change invalidation, and a basic mobile/keyboard check. The live-model test was skipped in this credential-free run.
- An approved synthetic handover was created in the fresh clone; after stopping and restarting its server, its Markdown export remained accessible with the same revision and evidence.
- A separate live-model browser run against a configured OpenAI-compatible endpoint passed: a fictional Slack export yielded 2 reviewable items and an excluded synthetic leadership source was absent from the final export. No production project data was sent.
- A read-only import from the public `octocat/Hello-World` GitHub repository returned 3 commits and 100 PRs, and correctly warned of additional PR pages.
- Automated coverage includes server-side scope invalidation, derivation-source recording, stale/concurrent approval checks, source-span verification, bad ZIP/path traversal, bounded request bodies, invalid model JSON and unavailable providers. Both provider protocol shapes were tested against a local fake server; this is **not** a real Anthropic API test.

## What the MVP does

On demand: import GitHub activity and/or a Slack export, select recipient-authorized sources, generate structured candidates using a configured model, validate quoted references, review/edit/exclude, approve, and export Markdown. PGLite persists local state and approved snapshots. Source selection changes invalidate the current draft and approval on the server.

## Limitations and unverified acceptance criteria

- **Access:** Source and recipient authorization are manual operator decisions. There are no authenticated recipient accounts, automated GitHub/Slack ACLs or source revocation checks. Existing downloaded exports cannot be revoked.
- **Evidence and AI:** Matching an excerpt validates a reference, not whether a claim is supported. Generated output can omit information or be wrong. There is no classifier evaluation, fine-tuning or semantic-verification guarantee.
- **Coverage:** Only the first 100 commits and PRs are imported; diffs, code contents, PR comments, Slack live APIs and other source types are not supported. Limits and partial coverage are surfaced.
- **Security and robustness:** Untrusted text is not executed and the app has origin/header checks, bounded JSON reads, capped ZIP entries and citation checks; this is not a comprehensive security audit or a guarantee against prompt injection. Multi-process behavior, broader failure and accessibility cases, secure physical erasure, and every original acceptance criterion are not fully verified.
- **Provider verification:** OpenAI-compatible inference was tested against a real configured service with synthetic input. Anthropic-compatible request/response handling was tested with a fake local server only.
- **Distribution:** Fresh-clone checks were performed locally by the same operator; a second independent contributor and GitHub-hosted CI have not yet been verified. No GitHub repository has been pushed or submitted in this work.
- **License:** Deferred at the user's direction for Round 2; none is included. No license grant should be assumed. A real private vulnerability reporting channel must be chosen before public distribution.
- **Future scope:** Causal graph, automated divergence detection, bus-factor heatmap, exit interrogator, continuous processing, Supabase sync and Laya/classifier integration are not implemented.

See `ROUND2.md` for a truthful demonstration script and proposed, not yet submitted, Round 3 improvements. The larger acceptance criteria remain in `~/REV_FUNDAMENTAL_MVP_SPEC.md`.
