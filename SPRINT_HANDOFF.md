# ReV sprint state

> **Historical handoff:** This snapshot predates the standalone graph-event table, model-assisted divergence candidates, citation repair, PostgreSQL import prototype, source refresh planning and local redaction work. Its state and priorities are not a current status report; see `REV_SYSTEMS_CHECKLIST.md` and Git history.

## Objective and constraints

Continue the full `REV_SYSTEMS_CHECKLIST.md` with real implementation and verification; leave the frontend lightweight because a teammate is working on it. Do not use subagents (explicit user direction), do not push without an explicit new push request, never touch unrelated services, do not claim automatic GitHub/Slack permissions or zero hallucination. Keep `PARTIAL`, `VERIFY`, and externally blocked checklist items honest.

## Local state at handoff

Working repository: `/home/fev/GitRepos/ReV`, local `main` clean at the time of writing. Remote `origin/main` was `7536ddd` at sprint start and does not include the new local work. Do not merge/rebase/push without checking current remote and user authorization.

Local checkpoints since public version:
- `6534b11` checklist.
- `6ee57e4` GitHub review/issue comments and bounded commit patches, synthetic fixtures, two-page pagination.
- `668aa25` per-run scope-filtered evidence graph and review API.
- `2241748` gap detection/answers as unselected source artifacts.
- `2a7ca0c` local Git ownership and churn analysis.
- `2c5ba25` real Laya zero-shot synthetic pilot vs keyword baseline; not a representative benchmark.
- `d9e6471` risk analysis bound to one revision.
- `e841a0d` refresh gap questions after edits.

## Verified receipts

At `2241748`: `pnpm verify` passed 24 TypeScript tests and 10 Rust tests plus typecheck, contract checks and production build. Playwright passed 3 browser tests, including actual graph API use and gap answer/approval invalidation. Subsequent risk changes: one real temporary Git repository integration test and 12 Rust tests passed. Subsequent gap changes: 8 targeted graph/gap/scope tests and typecheck passed. Re-run the complete suite after further edits.

Real GitHub read of `octocat/Hello-World`: 3 commits, 200 PRs, 200 review comments, 200 discussion comments, 3 commit patches, with explicit page-cap warnings. It was read-only.

Laya 0.4.29 base checkpoint ran CPU on 32 self-authored synthetic samples: 26/32 correct; keyword baseline 31/32, likely overfit because examples and rules were authored together. Runtime warned that a checkpoint temperature was clamped; treat confidence as uncalibrated. Full details and limitations: `evals/classification/PILOT.md`. Python experiment environment and downloaded model are in scratch and may be pruned; no dependency was added to app. An accidental initial environment install consumed disk but its scratch venv was removed; do not purge shared caches or unrelated files.

## Current priorities and important gaps

1. Graph implementation is deliberately partial. It records per-run review events in a mutable JSON payload, not a standalone append-only log. It creates citation support candidates and permits human-confirmed contradiction relationships but does NOT automatically detect semantic divergence. It invalidates graph scope epochs on source or claim changes. Finish event-store/replay, evidence-supported semantics, and independent security checks before broader claims.
2. Gap detector only flags unverified/reviewer-marked items and creates deterministic questions. Answers are captured through backend actions as unselected evidence; no frontend answer UI or full citation regeneration proof. `tests/gaps.test.ts` and browser API test exercise current behavior.
3. Ownership analyzer invokes local Git by subprocess and is only an experimental core operation, not wired to the UI. It returns blame/churn for a bounded local repository with revision and missing-coverage warnings; it is not a failure probability. `tests/risk.test.ts` creates a real two-author repo. Review subprocess/config/resource safety before exposing via browser.
4. The checklist still contains many unimplemented systems (full graph, secure multi-user auth/ACL, continuous ingestion, Supabase, classifier evaluation with independent real data, true interactive UI, etc.). Some require external accounts, human choice/verification, or an independent reviewer and cannot truthfully be ticked autonomously.
5. `VERIFICATION.md`, `README.md`, `ROADMAP.md`, `ROUND2.md` contain statements from the earlier MVP and may now be stale after the new backend additions; update when integration is ready, explicitly distinguishing partial APIs from usable features.
6. `src/lib/server/service.ts` returns full raw artifacts to the trusted local operator (intended local-only model); do not present this as authenticated recipient isolation. Graph projection and scope filtering are not a substitute for ACL enforcement.
7. `agent.max_turns` is now configured to 500 for new gateway turns. This does not guarantee infinite execution; preserve checkpoints and report real state if interrupted.

## Next recommended steps

- Run `git status`, inspect latest exact source and `REV_SYSTEMS_CHECKLIST.md`, then `cargo fmt --all --check && pnpm verify` to establish a new baseline.
- Finish graph/gap real integration and harden concurrency/security with behavioral tests. Avoid losing historical graph events or exposing stale scope.
- Extend code parsing, classifier baselines, persistence adapters and continuous updates in dependency order, but do not mark incomplete work complete.
- Record true blockers (license deferred by user; collaborator acceptance, third-party credentials, independent review, remote CI/push require external/user action).
