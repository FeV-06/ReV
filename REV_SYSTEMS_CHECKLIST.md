# ReV — Systems & Subsystems Checklist

**Purpose:** A working task list for the full ReV vision, with the implemented Round 2 MVP marked separately.

**Baseline:** Local `main` at `b1e1f49`; public `FeV-06/ReV` `main` at `7536ddd` (same product files, but no published GitHub Actions workflow).

**Scope:** Derived from the original team product specification, the fundamental MVP spec, the hackathon brief and the team's later discussion of Laya.

## How to read this checklist

- `- [x]` = that **specific, bounded subtask** is implemented or completed and supported by the evidence cited in its system section. It does not mean the larger system is finished.
- `- [ ]` = not implemented, incomplete, unverified, or a future decision. Prefixes **PARTIAL**, **VERIFY**, **DECIDE** and **LATER** explain why it remains open.
- No parent system is implicitly complete because one child is checked. A blank box is not necessarily a defect in the Round 2 MVP; many are intentionally beyond it.
- This is a snapshot, not a promise of accuracy for every possible dataset or environment. When completing a task, link its implementation and an actual test, manual check or decision.
- **Security boundary:** The current app is a local, single-operator tool. The operator manually confirms which sources a recipient may receive. It does **not** authenticate recipients or automatically verify GitHub/Slack access.
- **Evidence boundary:** Matching a quote and byte range proves the reference exists in the stored snapshot; it does not establish that the claim is true. Time proximity alone does not establish causality.
- **Fixture boundary:** The sample-data button uses clearly labeled deterministic output. A separate real-model run has been tested; do not present fixture output as model inference.

## System map

```text
User → workspace / on-demand run → GitHub + Slack ingestion → source snapshots
     → recipient scope → model extraction → reference validation → review
     → approve → recipient-scoped Markdown export
                          │
                          └─ Future: classification, causal graph, divergence,
                             bus factor, exit questions, cloud and live updates
```

---

# 1. Workspace, run lifecycle & orchestration

**MVP evidence:** `src/components/HandoverWorkspace.tsx`, `src/lib/server/service.ts`, `src/lib/server/store.ts`, `tests/browser.spec.ts`, `tests/scope.test.ts`.

## 1.1 User-initiated handover

- [x] Create a run with a unique ID, timestamp and recipient/role label.
- [x] Start imports only on user request; do not continuously poll sources in the background.
- [x] Start a fresh run for an updated snapshot rather than silently changing a previous run.
- [x] List and reopen recent local runs.
- [x] Allow an operator to delete a run and its stored approved revisions.
- [ ] **PARTIAL:** Display durable, detailed progress for every stage, including counts and elapsed time. Current run states and errors do not provide a complete progress timeline.
- [ ] **VERIFY:** Exercise empty input, fully failed imports, partial imports, retry and crash recovery through the actual UI.
- [ ] Add explicit cancellation and safe cleanup for a long-running import or model call.

## 1.2 State, revisions & concurrency

- [x] Persist run states for importing, awaiting scope, reconstructing, review, approval and failure.
- [x] Use version-checked updates to reject stale state changes.
- [x] Save approved revisions separately from the editable current run.
- [x] Reject one of two simultaneous approval attempts in the tested scenario.
- [x] Detect interrupted import/reconstruction on database initialization and mark it failed.
- [ ] **VERIFY:** Test broader concurrent requests, multiple processes, interruption and recovery against production-like storage.
- [ ] **VERIFY:** Test full revision history and deletion behavior across process restarts, including inaccessible/deleted sources.

---

# 2. Source connection, ingestion & normalization

**MVP evidence:** `crates/rev-core/src/github.rs`, `crates/rev-core/src/main.rs` (`normalize_github`, `slack_import`), `src/lib/server/service.ts`, `fixtures/`, Rust tests. A live `octocat/Hello-World` read returned 3 commits, 200 PRs, 200 review comments, 200 discussion comments and 3 commit patches, with explicit pagination warnings.

## 2.1 GitHub connector

- [x] Accept an `owner/repository` identifier and validate its allowed format.
- [x] Import commit messages/metadata and pull-request titles, bodies and metadata through the GitHub REST API.
- [x] Support an optional server-configured GitHub token for repositories it can access; avoid storing the token in a run.
- [x] Preserve commit/PR IDs, available author/time and GitHub source references.
- [x] Report GitHub API errors and when additional pages exist beyond the configured 200-record category limit.
- [ ] **PARTIAL:** Fetch complete paginated history with explicit limits, resume/retry and rate-limit handling. Two pages per category and explicit cap/rate-limit warnings work; resume and bounded retries remain open.
- [ ] **PARTIAL:** Import actual repository contents, changed files, commit diffs and branch state. Bounded GitHub commit patches are now imported; full files and branch state remain open. See `crates/rev-core/src/github.rs` and `github::tests`.
- [ ] **PARTIAL:** Import PR review comments, discussion threads, issues and task/ownership data. GitHub review and issue comments are now imported; full issue records and task/ownership data remain open.
- [ ] Provide GitHub App/OAuth authorization and source-permission mapping; token input alone is not recipient authorization.
- [ ] **VERIFY:** Test private-repository access, expired tokens, empty repositories and realistic rate-limit/error cases with authorized data.

## 2.2 Git parsing & code intelligence

- [ ] Parse commit deltas and blame with `libgit2` / Git tooling.
- [ ] Extract changed functions, types and modules using `tree-sitter` grammars.
- [ ] Map source symbols and files to commits, PRs, ownership and related decisions.
- [ ] Define language coverage, unsupported-language fallback and reproducible parsing tests.

## 2.3 Slack connector

- [x] Import a Slack-export ZIP containing supported channel/day JSON messages.
- [x] Preserve available author, timestamp, channel and thread identifier in normalized source data/references.
- [x] Retain a local export reference when a live Slack permalink is unavailable; do not invent one.
- [x] Apply compressed/expanded/file/message limits and reject invalid ZIPs, unsafe paths and symlink entries in the implemented parser.
- [ ] **PARTIAL:** Reconstruct full Slack thread context and construct reliable source permalinks when workspace/channel IDs permit it.
- [ ] Connect a live Slack bot/API with explicit scopes, access mapping and revocation handling.
- [ ] **VERIFY:** Test real authorized Slack exports and additional variants, malformed messages, size limits and private-channel handling.

## 2.4 Common source pipeline

- [x] Normalize imported GitHub and Slack records into source artifacts with stable external identifiers for the imported record.
- [x] Deduplicate GitHub commits/PRs and Slack messages within an import using their source identifiers.
- [x] Preserve a per-run snapshot of the imported text and provenance used by the handover.
- [x] Include synthetic GitHub/Slack fixtures with an excluded leadership-only example.
- [ ] Provide a documented, independently testable connector interface and contract suite for third-party adapters.
- [ ] Add additional authorized sources: task boards, meeting notes, documents and other project communications.
- [ ] Define retention, safe deletion and provenance behavior when an original source is modified or removed.

---

# 3. AI providers, extraction & classification

**MVP evidence:** `crates/rev-core/src/main.rs` (`generate`, `validate_candidates`), `src/lib/contracts.ts`, `tests/provider.test.ts`, `tests/live-provider.spec.ts`, `VERIFICATION.md`.

## 3.1 Provider gateway

- [x] Configure provider, endpoint, model and optional API key server-side through environment variables.
- [x] Implement an OpenAI-compatible chat-completions request path.
- [x] Implement an Anthropic-compatible messages request path; exercise its protocol against a local fake server.
- [x] Exercise one configured OpenAI-compatible model on synthetic Slack data in a prior live browser run.
- [x] Require explicit operator consent before sending selected source text to the configured provider.
- [x] Reject or report invalid response JSON, unavailable providers and invalid candidate shape.
- [ ] **VERIFY:** Exercise the Anthropic-compatible path against an actual authorized provider.
- [ ] **VERIFY:** Exercise a local model endpoint and document the exact tested model/endpoint; compatibility is not proof of an offline run.
- [ ] Add provider-specific structured-output options, bounded retries and configurable per-provider model behavior without hardcoding one model.
- [ ] Benchmark context-window limits and long-input behavior; replace the current reject-over-limit behavior with an explicit, evidence-preserving large-input strategy.

## 3.2 Structured knowledge extraction

- [x] Ask a configured model for typed handover candidates with source IDs and exact quotations.
- [x] Represent decision, open work, risk, dependency, next action, contact and unknown candidate categories.
- [x] Validate candidate shape and verify cited quotations against imported source snapshots.
- [x] Persist the full selected input-source set as derivation provenance on each generated item.
- [ ] **PARTIAL:** Evaluate extraction on representative multi-source examples and measure missed decisions, open work, dependencies and unsupported assertions.
- [ ] Support a deliberate multi-label taxonomy rather than the current single category per item.
- [ ] Improve explicit uncertainty, conflict and missing-evidence detection; route unresolved cases to human review.
- [ ] Handle duplicate/near-duplicate candidates and updates without erasing the original evidence trail.

## 3.3 Laya / alternative classifier research — not a selected implementation

- [ ] **PARTIAL / DECIDE:** Candidate use is classification of decision, open work, risk and other. A 32-example synthetic pilot ran against Laya and a keyword baseline (`evals/classification/PILOT.md`); real usefulness remains undecided.
- [ ] Build a representative, permission-safe labeled dataset and a held-out evaluation split.
- [ ] **PARTIAL:** Measure unmodified Laya and alternatives against baselines on representative held-out data. A small self-labeled synthetic CPU pilot measured the base checkpoint and keyword rules, but is not representative and does not establish calibration, multilingual or long-input quality.
- [ ] **DECIDE:** Choose whether Laya, another model, a hybrid, or no dedicated classifier is justified by results.
- [ ] **LATER:** Fine-tune or train a classifier only if the baseline evaluation and available labeled data justify it; re-evaluate on held-out data.
- [ ] If adopted, expose a replaceable classifier interface and model/version settings. Classifiers must not grant source access or certify claims as true.

---

# 4. Evidence, provenance & verification

**MVP evidence:** `crates/rev-core/src/main.rs` (`validate_candidates`), `src/lib/server/service.ts`, `src/lib/contracts.ts`, `tests/service.test.ts`, `tests/scope.test.ts`.

## 4.1 Source-linked citations

- [x] Retain source IDs, canonical source text snapshots and source references with imported records.
- [x] Match model-provided excerpts against stored source text and calculate UTF-8 byte offsets.
- [x] Mark a candidate without any valid citation as `unverified` instead of calling its reference validated.
- [x] Display supporting excerpts and source references during review; include permitted evidence in the approved Markdown export.
- [ ] **VERIFY:** Cover missing sources, incorrect quotes, UTF-8 boundary conditions, altered snapshots and mixed valid/invalid citations with end-to-end tests.
- [ ] Add precise Git file/line/commit citations once actual file/diff ingestion exists; improve resolvable Slack permalinks.
- [ ] Support semantic entailment review and explicit conflicts between evidence sources; a valid byte span is not proof of a claim.

## 4.2 Provenance and versioning

- [x] Record the complete source set consumed by a generation on each resulting item.
- [x] Refuse export when item provenance is missing or outside the currently selected scope.
- [x] Changing scope server-side clears the current draft and invalidates approval before regeneration.
- [ ] Provide an inspectable provenance view showing all inputs, model/provider/version, generation time and transformations for each claim.
- [ ] Add source-version integrity checks, revision diffs and a durable provenance audit trail suitable for later graph reconstruction.

---

# 5. Causal knowledge graph & decision history

**Status:** An initial scope-filtered graph is implemented after the MVP. It replays per-run relationship events and requires review; it is not yet the full original event-sourced project graph. Evidence: `src/lib/server/graph.ts`, `src/app/api/runs/[id]/graph/route.ts`, `tests/graph.test.ts`, `tests/scope.test.ts`, `tests/browser.spec.ts`.

## 5.1 Graph data model

- [ ] **PARTIAL:** Define source, decision, blocker/debt, contact, ownership and dependency node types. Source and generated-item category nodes exist; richer ownership/debt entities remain.
- [x] Define evidence-linked `supports`, `implements`, `supersedes` and candidate `contradicts` relationships, each proposed and reviewable.
- [ ] **PARTIAL:** Choose and implement the graph representation/storage. A TypeScript graph projection from per-run events exists; persistent project-level graph storage remains open.
- [ ] **PARTIAL:** Enforce or otherwise handle DAG invariants, cycles, duplicate nodes and graph migrations. Confirmed causal edges reject cycles/duplicates; migration and complete node invariants remain open.
- [ ] **PARTIAL:** Define an actual append-only event log and replay/rebuild semantics before calling the architecture event-sourced. Relationship events now live in a separate append-only `graph_events` table and replay under a scope epoch; full project event sourcing and migration/restart coverage remain open (`tests/graph-store.test.ts`).

## 5.2 Graph construction & browsing

- [ ] **PARTIAL:** Correlate discussions, decisions and code with inspectable evidence; distinguish known links from model-suggested links. Citation-based support edges are proposed automatically; semantic multi-source relationships remain open.
- [ ] Track decision history, supersession, unresolved discussions and project-state changes.
- [ ] Render an interactive timeline/graph with node selection, path traversal and evidence previews (`@xyflow/react` was proposed).
- [ ] Test ambiguous associations, conflicting claims, missing sources and graph rebuilds; never infer causality merely from timestamps.

---

# 6. Divergence, uncertainty & knowledge gaps

**Status:** Basic unverified/clarification flags and an opt-in, model-assisted divergence candidate action exist. The divergence path is tested with a local fake provider, not a validated real-world accuracy benchmark. Original spec §3 and `ROUND2.md`.

## 6.1 Divergence detection

- [ ] **PARTIAL:** Identify candidate disagreements between documented decisions, discussions and implementation. An opt-in model action proposes possible conflicts from selected sources; its quality and recall are unmeasured.
- [x] Require at least two distinct matching source references for returned model divergence candidates and mark them for clarification (`tests/provider.test.ts`, `tests/divergence.test.ts`).
- [ ] Have a human confirm, reject or clarify a proposed contradiction; do not automatically declare a semantic conflict as fact.
- [ ] Evaluate precision and recall on examples with real contradictions, benign changes and incomplete context.

## 6.2 Gap interrogator

- [x] Allow a reviewer to mark a generated handover item as needing clarification.
- [ ] **PARTIAL:** Detect missing explanations, orphaned decisions or unsupported code changes. `detect_gaps` currently identifies reviewer-flagged or unverified items; orphaned code/decision detection remains open.
- [ ] **PARTIAL:** Generate targeted exit questions. `detect_gaps` generates deterministic questions for flagged items; relevance and quality are not benchmarked.
- [ ] **PARTIAL:** Capture answers through a reviewable interface and store them as new, cited source material. Backend action creates an unselected reviewer-answer artifact; frontend answer UI and end-to-end citation verification remain open.
- [x] Invalidate current review and approval when a gap answer changes the source set, requiring the operator to reselect scope and regenerate (`tests/gaps.test.ts`).
- [ ] **LATER:** Add an optional Slack delivery channel/bot after access and security design.

---

# 7. Ownership, risk & bus-factor intelligence

**Status:** An experimental local-repository blame/churn analyzer exists in `crates/rev-core/src/risk.rs` and is exercised by `tests/risk.test.ts`; it is not yet connected to the web handover or heatmap. Original spec §3.

## 7.1 Repository ownership analysis

- [ ] **PARTIAL:** Calculate contributor ownership from Git blame with documented limitations and manually supplied email aliases; renamed-file and binary handling require further tests.
- [ ] **PARTIAL:** Measure recent churn and available test coverage without inventing missing data. The local analyzer computes 90-day churn and reports coverage as unknown; coverage ingestion remains open.
- [ ] **PARTIAL:** Define and validate a transparent fragility/bus-factor metric. An ownership × logarithmic churn heuristic is unit-tested but not calibrated against real incidents.
- [ ] **PARTIAL:** Identify files where departing-person ownership is concentrated; connect the tested local analyzer to the selected-source handover workflow.

## 7.2 Handover risk presentation

- [ ] Rank fragile modules and explain the evidence behind the ranking.
- [ ] Display an interactive module/ownership heatmap and link it to source evidence.
- [ ] Test multi-author modules, missing coverage, renamed files and inactive contributors.

---

# 8. Permissions, confidentiality & secure sharing

**MVP evidence:** `src/lib/server/service.ts` (`scope`, `generate`, `approve`, `exportMarkdown`), `src/components/HandoverWorkspace.tsx`, `tests/scope.test.ts`, `tests/browser.spec.ts`, `tests/service.test.ts`.

## 8.1 Manual local recipient scope

- [x] Start newly imported sources unselected for recipient generation/export.
- [x] Let the local operator select source records and explicitly confirm recipient authorization before generation and approval.
- [x] Send the selected source set—not excluded source text—to the generator in the implemented workflow.
- [x] Invalidate draft and approval on a server-side scope change; require regeneration and review.
- [x] Test that a restricted synthetic source is absent from the generated/exported handover in the exercised browser scenario.
- [ ] **VERIFY:** Expand tests to excluded source metadata, mixed-access derivations, stale clients and all export/read paths.
- [ ] Make privacy limitations and the risk of already-downloaded exports explicit in the sharing UX.

## 8.2 Actual access control — future system

- [ ] Add authenticated users, workspaces and recipient identities.
- [ ] Map actual GitHub/Slack source permissions to recipient access; handle permission changes and revocation.
- [ ] Design role/clearance policies and server-side authorization for every read, preview, search, graph and export path.
- [ ] Propagate restrictions to derived claims, citations, graph edges and cached artifacts without leaking hidden material.
- [ ] Implement and test graph pruning/projection and any re-bridging against inference or metadata leaks.
- [ ] Build a role-policy simulator and audit log **after** actual access enforcement exists.
- [ ] Conduct threat modeling and independent security testing before any multi-user or public-hosted deployment.

## 8.3 Input, secret & browser safety

- [x] Bind the supplied app scripts to loopback and apply same-origin/custom-header checks to local API requests.
- [x] Keep configured provider/GitHub credentials out of committed examples and run records; `.env.local` is ignored.
- [x] Bound request body reads and model responses; sanitize exported text against active markup.
- [x] Test invalid ZIP and traversal handling, cross-origin requests and selected output-escaping cases.
- [ ] Add systematic prompt-injection/XSS, secret-leak, hostile archive, URL and resource-exhaustion tests.
- [ ] Complete a security review; explicitly verify residual risks and unsupported deployment environments.
- [ ] Configure a real private vulnerability-reporting channel before inviting public vulnerability reports.

---

# 9. Human review & handover delivery

**MVP evidence:** `src/components/HandoverWorkspace.tsx`, `src/lib/server/service.ts`, `tests/browser.spec.ts`, `tests/scope.test.ts`.

## 9.1 Review workbench

- [x] Show generated items, their categories, reference status and available evidence excerpts.
- [x] Let the reviewer edit text, exclude items and mark items needing clarification.
- [x] Mark an edited claim unverified and remove its prior citations rather than silently claiming the edit is supported.
- [x] Save a review and require explicit approval of the current revision.
- [x] Store approved snapshots and invalidate the current approval when review changes.
- [ ] Allow the reviewer to attach or repair citations for an edited item through the UI.
- [ ] Add distinct confirm/reject/redact states and granular redaction, rather than only excluding an item.
- [ ] Add reviewer identity, audit history and collaborative review after authentication is designed.

## 9.2 Successor handover

- [x] Export an explicitly approved Markdown handover containing non-excluded items and permitted citations.
- [x] Show incomplete source coverage without exporting potentially restricted warning details.
- [x] Block export until approval and re-approval following a changed scope/revision.
- [ ] Build a true authenticated, role-tailored successor portal; the current recipient label is descriptive only.
- [ ] Produce a source-backed, actionable Day-1 checklist and ownership/contact view with human-confirmed next steps.
- [ ] Add version comparison, controlled sharing, receipt acknowledgement and a clear continuation workflow.
- [ ] Consider additional output formats, including PDF, after defining their security and review requirements.

---

# 10. Storage, local/cloud deployment & continuous updates

**MVP evidence:** `src/lib/server/store.ts`, `src/lib/server/core.ts`, `tests/store.test.ts`, `VERIFICATION.md` (fresh-clone restart test).

## 10.1 Local storage and processing

- [x] Use Node-owned PGLite for local runs, source snapshots and approved revisions.
- [x] Invoke the Rust core as a child process using a typed JSON exchange; the browser does not call a separate Rust HTTP service.
- [x] Persist and reopen a synthetic approved handover after an actual server restart in the documented verification.
- [ ] **VERIFY:** Test schema migration, interrupted runs, concurrent/multiple-process access and full deletion behavior under failure.
- [ ] Establish supported OS/toolchain versions and test local-model/offline operation before claiming air-gapped support.
- [ ] Complete typed interfaces and tests for alternative persistence backends.

## 10.2 Supabase and collaboration — later

- [ ] Implement a Supabase/PostgreSQL storage adapter and migrations.
- [ ] Define and test PGLite↔Supabase data transfer, conflict handling and compatibility rather than assuming it.
- [ ] Add multi-tenant RLS and real authenticated access boundaries.
- [ ] Add realtime collaborative review and optional `pgvector` search with permission-aware indexing.

## 10.3 Continuous processing — later

- [x] Establish the user-approved sequence: **on-demand first, continuous processing later**.
- [ ] **DECIDE:** Choose whether source updates arrive through webhooks, polling, scheduled sync or another mechanism.
- [ ] Implement incremental ingestion, deduplication, versioning, retry and source revocation handling.
- [ ] Recompute affected claims/graph paths and invalidate affected approvals when sources or permissions change.
- [ ] Test idempotency, missed events, downtime recovery and consistency across local/cloud modes.

---

# 11. Frontend, usability & accessibility

**MVP evidence:** `src/components/HandoverWorkspace.tsx`, `src/app/`, `tests/accessibility.spec.ts`, `tests/browser.spec.ts`.

## 11.1 Basic application surface

- [x] Provide a Next.js/React local interface for run creation, source selection, review, approval and export.
- [x] Show a labeled synthetic example, source coverage warnings and an operator authorization confirmation.
- [x] Provide a responsive layout and a basic automated mobile/keyboard smoke check.
- [ ] **VERIFY:** Complete the full run-to-export journey using only the keyboard and run broader accessibility checks.
- [ ] Improve empty/loading/error/recovery states and stage-specific progress for longer real imports.
- [ ] Add the original vision's graph canvas, bus-factor heatmap, review citation drawer and Day-1 action deck.
- [ ] **DECIDE:** Review/implement the originally proposed Tailwind/Shadcn design system if useful; the MVP currently uses custom CSS.

---

# 12. Contracts, testing, packaging & contributors

**MVP evidence:** `src/lib/contracts.ts`, `contracts/domain.v1.schema.json`, `scripts/contracts.ts`, `tests/`, `README.md`, `CONTRIBUTING.md`, `VERIFICATION.md`. Local validation was rerun on the checklist baseline.

## 12.1 Cross-language contracts

- [x] Define Zod types for imported artifacts, citations, candidates, drafts and runs.
- [x] Generate and check the JSON Schema from the TypeScript definitions.
- [x] Validate representative Rust import/model outputs against the generated shared schema in Rust tests.
- [ ] Complete independent connector/provider/storage extension interfaces and consumer contract tests; the present Rust core still combines multiple responsibilities.
- [ ] Define explicit version/migration compatibility for persisted runs and external integrations.

## 12.2 Verification and CI

- [x] Pass local formatting, TypeScript checks, contract check, unit tests and production build (`cargo fmt --all --check` and `pnpm verify`).
- [x] Run a credential-free fresh-clone setup and synthetic browser workflow on the same machine, as recorded in `VERIFICATION.md`.
- [x] Exercise a real OpenAI-compatible provider with synthetic data and a real public GitHub repository import, as recorded in `VERIFICATION.md`.
- [x] Test a basic mobile viewport, keyboard interaction, source-scope invalidation and an export after a server restart.
- [ ] Run the complete original MVP acceptance matrix, including adversarial and mixed-access cases; do not treat the build alone as full compliance.
- [ ] Have a second contributor independently follow setup, run the app and report friction.
- [ ] Publish the GitHub Actions workflow and verify a passing run on the exact published commit. A workflow exists on local `main` but GitHub currently reports none.
- [ ] Add browser E2E tests to CI and document how to supply test-only model services without production secrets.

## 12.3 Contributor & publication operations

- [x] Provide README, contributor guide, roadmap, environment example, synthetic fixtures and issue/PR templates.
- [x] Publish the application repository at `https://github.com/FeV-06/ReV`.
- [ ] **DECIDE / DEFERRED:** Choose a license when the team wants one. Per the user, it is not required for the current round; no reuse license should be assumed.
- [ ] Configure private vulnerability reporting and review public-facing security guidance.
- [ ] Confirm collaborators have accepted their GitHub invitations; pending invitations are not active write access.
- [ ] Keep this checklist updated as features land, distinguishing implemented, tested, partial and proposed work.

---

# 13. Round 2 delivery & Round 3 planning

**Evidence:** `ROUND2.md`, `VERIFICATION.md`, GitHub repository. Round 2 uses a working central workflow; the original full graph/heatmap/exit-interrogator scope is not finished.

## 13.1 Round 2 submission

- [x] Have a public/judge-accessible source repository for the current implementation.
- [x] Document the local setup, synthetic demo steps, significant tools and known limitations.
- [x] Keep the real model demo separate from the fixture-only walkthrough.
- [ ] **VERIFY:** Provide judges a permitted, runnable delivery method; the current app is local-only and must not be exposed publicly as-is.
- [ ] **VERIFY:** Add actual testing/feedback evidence and disclose models, APIs, datasets, libraries, external services and significant AI assistance used for the submission.
- [ ] **VERIFY:** Confirm every required participant submission, project document, repository link and event deadline against the organizer's current instructions.
- [ ] **DECIDE:** Team selects three substantial, achievable Round 3 improvements and submits them. The options in `ROUND2.md` are proposals, not confirmed commitments.

## 13.2 Candidate improvements after Round 2

- [ ] Evidence-supported causal graph and inspectable decision timeline.
- [ ] Targeted gap questions plus human-reviewed contradiction detection.
- [ ] Real role-based sharing and source-permission integration.
- [ ] Evaluate Laya/other classifiers and continuous processing separately against the team's priorities.

---

## Evidence & maintenance notes

- Original full product specification: `~/BEV_PRODUCT_SPEC.md` (internal; contains historical architecture claims and is not itself implementation evidence).
- Fundamental MVP specification: `~/REV_FUNDAMENTAL_MVP_SPEC.md` (some original publication/role assumptions have since changed; user explicitly deferred licensing).
- Implementation and known limitations: [`README.md`](README.md), [`VERIFICATION.md`](VERIFICATION.md), [`ROUND2.md`](ROUND2.md), [`ROADMAP.md`](ROADMAP.md).
- Key implementation paths: `crates/rev-core/src/main.rs`, `src/lib/contracts.ts`, `src/lib/server/{core,service,store,body}.ts`, `src/components/HandoverWorkspace.tsx`.
- Key tests: `tests/{scope,provider,service,store,body}.test.ts`, `tests/{browser,accessibility,live-provider}.spec.ts`, Rust unit tests.
- The original spec's absolute claims of “zero hallucination”, “leak-proof” pruning and “100%” database compatibility are aspirations, not verified guarantees.
- Remote snapshot checked separately: public `main` at `7536ddd`; `.github/workflows/verify.yml` exists only on local `main`, so a GitHub-hosted CI pass has not been established.
