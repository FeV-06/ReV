# MVP verification status

The implementation is an early local prototype, not yet fully compliant with the fundamental MVP specification. Verified locally: Next.js production build and TypeScript checks; Rust unit tests; synthetic Slack ZIP import and path traversal rejection; live read-only public GitHub import; browser flow through scope selection, fixture generation, review, approval and export; one configured OpenAI-compatible model generated evidence-linked items from a synthetic Slack export. The live model test is opt-in.

## Remaining release work

- Run state is stored as a JSON document in PGLite; approved revisions are snapshotted separately and writes use a versioned compare-and-swap. The persistence unit test checks stale-write rejection and snapshot retention. Full derivation provenance and additional multi-process/concurrent request tests are still needed.
- Selection changes made in the browser are not persisted until generation. The browser disables export/approval if selection differs, but server-side scope change and invalidation are not independently modeled. Implement a server-enforced scope transition and concurrent transition tests.
- Rust data structures and TypeScript Zod definitions are manually synchronized; the JSON Schema is only provided for import results. Add comprehensive shared contract generation/validation and tests for all domain types.
- Provider implementation has been exercised with a live OpenAI-compatible endpoint; Anthropic-compatible request path has not been tested against a real Anthropic-compatible service.
- The structured reconstruction may omit details or return unsupported material. There is no measured model quality benchmark, per-classifier evaluation, retry policy, or automatic semantic entailment verification.
- Public CI configuration is written but has not run on GitHub. Fresh-clone reproducibility and second-contributor setup review are not yet verified.
- A project license and a private security reporting contact have not been chosen. Do not publish as an open-source project until the owner selects a license and configures reporting.
- GitHub/Slack adapters have limited coverage and no live Slack workspace permissions; classification/ACLs are not automated. Local machine/browser compromise and access to previously exported Markdown are outside the local operator boundary.
- More work remains for strict resource caps on inbound HTTP bodies and archive decompression, concurrency and crash recovery, secure artifact deletion, real access controls, accessibility tests, and durable stage-level progress.

The parent spec and its MVP release gate remain the source of truth for all missing acceptance criteria. No claim is made that the full gate passes.
