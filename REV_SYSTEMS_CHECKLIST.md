# ReV — Systems & Subsystems Checklist

**Purpose:** A working task list for the full ReV vision, with the implemented Round 2 MVP marked separately.

**Baseline:** Historical MVP baseline `b1e1f49`; subsequent backend changes and verification are tracked in the sections below and Git history. The public branch can differ from the local work; check Git rather than treating this document as live branch status.

**Scope:** Derived from the original team product specification, the fundamental MVP spec, the hackathon brief and subsequent product decisions. The user has approved a three-part local architecture: Node-based background daemon retaining the Rust core, a local multi-project dashboard, and a workspace-scoped VS Code extension that bundles the handover UI.

## How to read this checklist

- `- [x]` = that **specific, bounded subtask** is implemented or completed and supported by the evidence cited in its system section. It does not mean the larger system is finished.
- `- [ ]` = not implemented, incomplete, unverified, or a future decision. Prefixes **PARTIAL**, **VERIFY**, **DECIDE** and **LATER** explain why it remains open.
- Existing checked items describe the **current Next.js MVP or recorded decisions**, not automatically the new daemon, dashboard or extension. Each migration and cross-client verification remains open until tested.
- No parent system is implicitly complete because one child is checked. A blank box is not necessarily a defect in the Round 2 MVP; many are intentionally beyond it.
- This is a snapshot, not a promise of accuracy for every possible dataset or environment. When completing a task, link its implementation and an actual test, manual check or decision.
- **Security boundary:** The current app is a local, single-operator tool. The operator manually confirms which sources a recipient may receive. It does **not** authenticate recipients or automatically verify GitHub/Slack access.
- **Evidence boundary:** Matching a quote and byte range proves the reference exists in the stored snapshot; it does not establish that the claim is true. Time proximity alone does not establish causality.
- **Fixture boundary:** The sample-data button uses clearly labeled deterministic output. A separate real-model run has been tested; do not present fixture output as model inference.

## System map and approved operating model

```text
Local dashboard ─┐                                  ┌─ approved local directories
                 ├─ authenticated local API ─► daemon ── committed history + saved/uncommitted changes
VS Code extension┘                            │     └─ optional authorized GitHub + Slack sources
  current workspace                          ├─ single storage owner + incremental index
  bundled handover UI                        └─ on-demand handover → scope → review → export
```

- **Daemon (target):** Node service reusing the current TypeScript orchestration/PGLite and invoking the Rust core; a single headless daemon owns registered projects, watching, jobs and persistent state. It starts automatically on computer start for the configured user account on Linux and Windows, subject to a platform-specific implementation and test. It remains active when both UIs are closed; sleep, shutdown and power loss are not uninterrupted operation.
- **Dashboard (target):** A local website for registering watched directories and GitHub usernames, monitoring project/index/daemon health and managing settings, privacy and handovers across projects.
- **VS Code extension (target):** A bundled workspace-scoped handover UI backed by the same daemon. The extension host mediates its webview-to-daemon requests; no separate database, indexer or required Next.js server inside the extension. Reuse existing React workflow where practical, not an unmodified Next.js server.
- **Capture (approved):** Continuously track committed history **and** saved/uncommitted changes in explicitly registered directories. Initial backfill and restart reconciliation must be specified and tested. Unsaved editor buffers are a separate open decision; do not imply disk watchers can see them.
- **Generation and privacy:** Creating a handover remains on demand with explicit recipient/source selection and review; whether AI performs any automatic background processing remains undecided. A GitHub username is contributor context, not proof of local edits; the target role is relevance context, not permission. No external source/model access without the existing authorization/consent boundaries.
- **Current implementation:** A manually started, local Node daemon now owns the PGLite-backed handover API; the Next.js workbench proxies to it. There is no persistent watcher, autostart setup, multi-project dashboard or VS Code extension yet. The current daemon is an integration foundation, not the complete target architecture.

---

# 1. Workspace, run lifecycle & orchestration

**MVP evidence:** `src/components/HandoverWorkspace.tsx`, `src/lib/server/service.ts`, `src/lib/server/store.ts`, `tests/browser.spec.ts`, `tests/scope.test.ts`.

## 1.1 User-initiated handover

- [x] Create a run with a unique ID, timestamp and recipient/role label.
- [ ] **PARTIAL:** Capture a GitHub contributor username and a separate target role for each new handover. Optional fields now persist, survive refresh, appear in the workspace/export, and are passed as untrusted generation context (`tests/handover-context.test.ts`, `tests/browser.spec.ts`). Contributor-specific collection, confirmed alias mapping and validated role-tailored output remain open.
- [x] **CURRENT MVP:** Start imports only on user request; the present app does not continuously poll sources. This is historical implementation evidence, not the approved daemon's future behavior.
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
- [ ] **PARTIAL:** Identify a selected contributor's GitHub activity. Direct API-linked account handles are retained on imported commits, patches, PRs and comments; a bounded contributor-filtered GitHub commit query supplements recent activity and checks the linked login. `KingSahil/Blinky` / `FeV-06` was exercised through the daemon; missing associations are not inferred. Full history, manual alias confirmation and completeness testing remain open.
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
- [ ] **PARTIAL:** Propagate restrictions to derived claims, citations, graph edges and cached artifacts. `access.ts` has a tested pure fail-closed projection, but it is not wired to authenticated routes or real source permissions and provides no current access control (`tests/access.test.ts`).
- [ ] Implement and test graph pruning/projection and any re-bridging against inference or metadata leaks.
- [ ] Build a role-policy simulator and audit log **after** actual access enforcement exists.
- [ ] Conduct threat modeling and independent security testing before any multi-user or public-hosted deployment.

## 8.3 Input, secret & browser safety

- [x] Bind the supplied app scripts to loopback and apply same-origin/custom-header checks to local API requests.
- [x] Keep configured provider/GitHub credentials out of committed examples and run records; `.env.local` is ignored.
- [x] Bound request body reads and model responses; sanitize exported text against active markup.
- [x] Test invalid ZIP and traversal handling, cross-origin requests and selected output-escaping cases.
- [ ] Add systematic prompt-injection/XSS, secret-leak, hostile archive, URL and resource-exhaustion tests.
- [ ] **PARTIAL:** Complete a security review; `docs/SECURITY_MODEL.md` records the current trust boundary and limitations, but no independent security audit has been performed.
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
- [ ] **PARTIAL:** Allow the reviewer to attach or repair citations for an edited item through the UI. A server action validates exact selected-source quotes and invalidates approval (`tests/citation-flow.test.ts`); no UI control exists yet.
- [ ] **PARTIAL:** Add distinct confirm/reject/redact states and granular redaction, rather than only excluding an item. The local-only `redact_source` API can create an unselected copy with an exact phrase replaced and invalidate the current approval (`tests/redaction.test.ts`); the original remains stored and selectable, prior downloaded exports cannot be recalled, and this is not recipient access enforcement. No redaction UI exists yet.
- [ ] Add reviewer identity, audit history and collaborative review after authentication is designed.

## 9.2 Successor handover

- [x] Export an explicitly approved Markdown handover containing non-excluded items and permitted citations.
- [x] Show incomplete source coverage without exporting potentially restricted warning details.
- [x] Block export until approval and re-approval following a changed scope/revision.
- [ ] Build a true authenticated, role-tailored successor portal; the current target role is untrusted generation context, not an access policy, and its tailoring quality has not been evaluated.
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

- [ ] **PARTIAL:** Implement a Supabase/PostgreSQL storage adapter and migrations. Explicit snapshot import into an empty PostgreSQL target exists (`src/lib/server/archive.ts`); the application does not use PostgreSQL as its runtime store, and real Supabase remains untested.
- [ ] **PARTIAL:** Define and test PGLite↔Supabase data transfer, conflict handling and compatibility. A one-way snapshot import to PostgreSQL 17 was exercised with synthetic data and refuses nonempty targets (`tests/archive.test.ts`); reverse transfer, live sync and actual Supabase validation remain open.
- [ ] Add multi-tenant RLS and real authenticated access boundaries.
- [ ] Add realtime collaborative review and optional `pgvector` search with permission-aware indexing.

## 10.3 Continuous capture and on-demand handovers

**Decision update:** The earlier on-demand-only MVP remains valid historical evidence, but the approved target now captures local changes continuously via the daemon. Generation is on demand. Remote webhook/polling choices remain separate decisions.

- [x] **HISTORICAL DECISION:** The initial MVP was on demand first; the later design now calls for local continuous capture.
- [ ] Select and test efficient native filesystem/Git change detection with a reconciliation strategy for missed events; decide remote GitHub/Slack update triggers separately.
- [ ] **PARTIAL:** Implement incremental ingestion, deduplication, versioning, retry and source revocation handling. A bounded snapshot-diff/refresh API exists and defaults new content to unselected; it rejects changes or revocations affecting previously selected sources until atomic prior-approval invalidation is implemented (`tests/refresh.test.ts`, `tests/refresh-flow.test.ts`). No scheduler or live connector is wired.
- [ ] Recompute affected claims/graph paths and atomically invalidate prior approvals when sources or permissions change; the current refresh implementation fails closed instead of making unsafe updates.
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
- [x] Publish the GitHub Actions workflow and verify a passing run on the exact published baseline commit `6c2f98c` ([run 42586293957](https://github.com/FeV-06/ReV/actions/runs/42586293957)). Later commits must be checked separately.
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
- [ ] Evaluate Laya/other classifiers and the detailed background AI-processing policy separately against the team's priorities.

---

# 14. Daemon, local watching and lifecycle — target architecture

**Status:** A manually started Node daemon and versioned local handover API exist; the Next.js workbench now proxies to it. `tests/daemon-process.test.ts` exercises the actual child process, authentication, current-store reuse, approval invalidation and restart. Automatic startup, watching, project registry, Windows verification and VS Code integration remain open.

## 14.1 Daemon service, API and migration

- [ ] **PARTIAL:** Extract project/run orchestration and PGLite ownership from the Next.js process into one headless Node daemon; retain the Rust core behind a typed interface and preserve existing handover behavior. Existing run routes proxy to a manually started daemon; project management and complete lifecycle remain open.
- [ ] Define a versioned, documented local daemon API and shared client contracts for project registration, status, capture, run/review/export and errors; add consumer/compatibility tests.
- [ ] **PARTIAL:** Ensure a single owner opens the persistent store; both clients use its API and never independently open or mutate the daemon database. The current dashboard routes use the daemon, and a second daemon using the same data directory is rejected; extension and abnormal-crash recovery remain open.
- [ ] Implement single-instance detection, readiness/health status, graceful shutdown, bounded work queues, cancellation, failure reporting and clean restart; stop/restart only ReV-owned processes.
- [ ] Migrate existing PGLite runs, approvals, source and graph events into daemon-owned storage using a backed-up, versioned, tested migration; preserve legacy runs and avoid destructive changes.
- [x] Verify the existing scoped synthetic handover through the daemon API, including approval invalidation and restart persistence (`tests/daemon-process.test.ts`); browser workflow was also exercised through the dashboard proxy. This is not proof of all daemon migration items.

## 14.2 Linux and Windows installation and autostart

- [ ] Define installation, runtime packaging, data locations and minimum supported Linux/Windows/Node versions; deliver the required Node runtime and Rust executable appropriately for each supported target.
- [ ] Install/configure ReV daemon automatic startup for the configured user account at computer start using an appropriate Linux mechanism; document exact behavior across boot, login, logout and user sessions, and make start/stop/disable/uninstall explicit.
- [ ] Implement equivalent automatic startup for the configured user account on Windows; define and test boot-versus-login behavior and Windows paths without requiring administrator rights unless specifically justified.
- [ ] Test startup, absence of a logged-in session where supported, duplicate launch, crash/restart, reboot/relogin, sleep/wake, shutdown and uninstall on real Linux and Windows environments. State any platform limitations rather than claiming 24/7 operation during sleep or shutdown.
- [ ] Document secure user-scoped file permissions, service logs, troubleshooting and runtime updates; never log credentials or captured source content by default.

## 14.3 Project registry and attribution

- [ ] **PARTIAL:** Register, list, update, pause/resume and remove explicit local project roots; persist each project's GitHub username and repository linkage without silently changing an existing project. Authenticated daemon API stores and removes canonical Git roots and usernames, rejects overlaps, and persists a paused state; capture/resume and dashboard controls are not implemented (`tests/projects.test.ts`, `tests/daemon-process.test.ts`). An isolated checkout of `KingSahil/Blinky` was registered with `FeV-06` without modifying its HEAD.
- [ ] Detect Git root/remote and overlapping or nested directories safely; canonicalize paths and prevent traversal/symlink escapes while reporting inaccessible, renamed or removed roots.
- [ ] Associate committed history using trustworthy GitHub account linkage or explicitly confirmed Git aliases; flag unmatched/ambiguous attribution rather than guessing.
- [ ] Represent saved/uncommitted edits separately from committed changes. Treat the configured username as the observer's declared context, not verified authorship of each local edit; preserve timestamp, path and snapshot provenance.
- [ ] Record per-project indexing status, last successful checkpoint, pending work, errors and coverage; distinguish active, paused, inaccessible and incomplete states.

## 14.4 Incremental local capture

- [ ] Baseline and incrementally index committed Git history for a registered project; capture new commits and relevant diffs while retaining revision and attribution evidence.
- [ ] Capture saved tracked/untracked working-tree changes without requiring a commit; correctly handle staging/unstaging, file deletion/rename, branch/HEAD switch, reset, merge and checkout, labeling uncommitted evidence accordingly.
- [ ] Define and enforce exclusions for secrets, ignored files, generated output, binaries, oversized files and user-configured patterns; never assume `.gitignore` alone protects secrets.
- [ ] Debounce/coalesce event bursts, bound memory/disk/CPU, avoid indexing loops from daemon outputs, and use native file events where suitable with explicit overflow/error handling.
- [ ] On start, resume, missed notifications, crashes and sleep/wake, reconcile actual Git/disk state idempotently without silent gaps; deduplicate events and expose incomplete coverage.
- [ ] **DECIDE:** Specify whether and how unsaved editor buffers can be captured through the extension; a daemon disk watcher alone cannot observe them.
- [ ] **DECIDE:** Set retention, snapshot granularity, secret-detection policy and whether background AI/remote processing is allowed; capture of uncommitted material remains within these explicit controls.
- [ ] Benchmark idle and active CPU, memory, IO and index latency on representative Linux and Windows repositories; define budgets and demonstrate that closing both UIs leaves capture running.

## 14.5 Local security and governance

- [ ] Authenticate daemon clients and authorize project-scoped operations; protect against cross-origin requests, DNS rebinding, other local users, unauthorized local processes and token leakage. Evaluate the actual transport on both OSes rather than assuming loopback is sufficient.
- [ ] Define explicit directory-registration consent and controls for capture pause, exclusions, deletion and retention; report stored data and the effect of removing a watched project.
- [ ] Exclude secrets from remote providers, exports and logs; keep uncommitted content out of those channels unless explicitly selected/authorized. Re-check recipient scope before sharing and disclose already-exported copies cannot be recalled.
- [ ] Verify watched-path containment, symlinks, hostile repositories, mixed-project access, stale/revoked permissions, cross-client races, malformed requests and workspace-trust handling with security tests.

---

# 15. Local daemon dashboard — multi-project website

**Status:** An initial Next.js dashboard uses the daemon API to show connectivity and register/remove Git projects. It explicitly says capture is not implemented; health monitoring, privacy controls and full multi-project handovers remain open.

## 15.1 Project and daemon management

- [ ] **PARTIAL:** Build a local dashboard connected to the daemon API, not a parallel backend/database; show daemon availability, version and actionable offline/reconnect states. The current dashboard shows protocol/connection status and retry; richer health and version details remain open (`src/components/ProjectDashboard.tsx`).
- [ ] **PARTIAL:** Add a directory picker or explicit path setup with GitHub username, repository linkage and consent; display what will be watched and which data categories are captured. The dashboard registers a Git root and username with explicit consent but clearly states capture is not active; future capture controls remain open (`tests/browser.spec.ts`).
- [ ] List registered projects and present per-project index status, coverage, latest sync, progress, warnings, active/paused state and errors.
- [ ] Provide project pause/resume, exclusions, settings, remove/delete-data controls and daemon autostart controls with clear confirmation and scope.
- [ ] Retain multi-project handover run browsing, source/recipient scope, review, approval and export by calling the daemon; distinguish committed from uncommitted evidence.
- [ ] Keep API credentials and auth material out of URLs, webview content, logs and source-controlled configuration; require explicit authorization before remote processing.

## 15.2 Dashboard verification

- [ ] Test onboarding and two independent projects, project isolation, pause/resume, excluded files and stale/unavailable projects using real temporary directories and Git repositories.
- [ ] Test disconnected/reconnected daemon, restart persistence, browser security/origin behavior, settings changes and accessible keyboard/mobile workflows.

---

# 16. VS Code extension — workspace-scoped handover client

**Status:** Not implemented. The current `HandoverWorkspace.tsx` and styles are reusable candidates but are coupled to Next.js HTTP routes and need extraction. The extension must work against the same daemon as the dashboard.

## 16.1 Extension host, workspace and daemon connection

- [ ] Create an extension host package, manifest, activation/commands and typed daemon client; detect and communicate daemon availability without silently launching a second store or index.
- [ ] Determine the active local workspace/project root, match it to a registered daemon project, handle no-folder and unregistered-folder states, and offer a user-confirmed registration path.
- [ ] Handle multi-root workspaces with an explicit project choice and correct updates when workspace folders change; do not expose another project's evidence by default.
- [ ] Respect VS Code Workspace Trust and restrict initial support to local Linux/Windows workspaces; explicitly signal unsupported Remote SSH/WSL/containers and browser-hosted contexts until designed and tested.
- [ ] Define the extension/daemon authentication and communication protocol for Windows and Linux; isolate secrets from the webview and require a version handshake with actionable incompatibility errors.

## 16.2 Bundled current handover UI

- [ ] Extract reusable React handover presentation from Next.js-only routing and relative `fetch` calls; keep existing scope, review and export behaviors compatible during migration.
- [ ] Bundle the handover UI and assets into the extension VSIX; load through a VS Code webview with restricted resource roots and content-security policy.
- [ ] Route structured, validated messages between webview and extension host, then daemon; preserve request correlation, errors, cancellation and project scope. Do not pass credentials to the webview.
- [ ] Provide contributor identity and target-role context for the open project, explicit recipient/source confirmation, evidence review and approved export inside VS Code.
- [ ] Handle daemon offline/startup/reconnection, incomplete indexing, project removal and stale approvals without losing user-visible review state or misrepresenting current data.

## 16.3 Extension testing and distribution

- [ ] Package a lean VSIX without development dependencies or user source data; verify installation, activation, updating and removal on local Linux and Windows VS Code.
- [ ] Test actual extension-host ↔ webview ↔ daemon integration for single- and multi-root workspaces, trust restrictions, cross-project isolation, daemon restarts and protocol mismatch.
- [ ] Run the same synthetic scope → generation → review → approval → export journey from the extension and dashboard and verify both see the same state; retain keyboard/accessibility checks.

---

## Migration order and review gates

1. **Daemon seam:** define contracts and secure local communication, extract existing backend/store, migrate data and pass the existing workflow through the new owner.
2. **Watching and lifecycle:** register a real local Git project, establish the first baseline, watch commits and saved/uncommitted changes, reconcile missed events, and implement/test platform-specific startup.
3. **Dashboard:** manage projects and surface capture/daemon health using that same API.
4. **VS Code extension:** bundle the extracted handover UI and connect the active workspace to the daemon; verify the same data and review workflow across both clients.

These are dependency priorities, not completed features or a promise that every platform edge is solved. Preserve existing check marks as MVP evidence; require separate Linux/Windows, privacy and end-to-end verification for the new architecture.

### End-to-end acceptance target

With ReV installed and a computer started, the configured user's daemon starts automatically on each supported OS. The user registers a local Git project and username in the dashboard, and ReV indexes committed activity and saved/uncommitted changes while both interfaces are closed. Opening that project in VS Code connects the extension's bundled handover view to the **same** daemon data. The user chooses a target role, scopes authorized evidence, reviews and approves a handover, and can see the same state in the dashboard. A daemon restart catches up safely; pausing a project prevents further capture; excluded files and unauthorized evidence do not enter the generated/exported handover. Demonstrate on both Linux and Windows without substituting synthetic data for actual capture.

---

## Evidence & maintenance notes

- Original full product specification: `~/BEV_PRODUCT_SPEC.md` (internal; contains historical architecture claims and is not itself implementation evidence).
- Fundamental MVP specification: `~/REV_FUNDAMENTAL_MVP_SPEC.md` (some original publication/role assumptions have since changed; user explicitly deferred licensing).
- Implementation and known limitations: [`README.md`](README.md), [`VERIFICATION.md`](VERIFICATION.md), [`ROUND2.md`](ROUND2.md), [`ROADMAP.md`](ROADMAP.md).
- Key implementation paths: `crates/rev-core/src/main.rs`, `src/lib/contracts.ts`, `src/lib/server/{core,service,store,body}.ts`, `src/components/HandoverWorkspace.tsx`.
- Key tests: `tests/{scope,provider,service,store,body}.test.ts`, `tests/{browser,accessibility,live-provider}.spec.ts`, Rust unit tests.
- The original spec's absolute claims of “zero hallucination”, “leak-proof” pruning and “100%” database compatibility are aspirations, not verified guarantees.
- GitHub-hosted CI passed on published commit `6c2f98c`; check the remote branch and Actions results separately for later commits.
