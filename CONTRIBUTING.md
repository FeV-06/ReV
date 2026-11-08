# Contributing

ReV is an early local-first handover prototype. Start with the README and roadmap. Discuss larger changes before implementation. Do not use real company data or credentials in issues, tests, recordings, logs or pull requests.

## Setup and checks

```sh
pnpm install --frozen-lockfile --ignore-scripts
cargo build --workspace
pnpm verify
```

Run `pnpm exec playwright install chromium` once, then `pnpm dev` in one terminal and `pnpm exec playwright test` in another for the browser workflow. Set `REV_CHROMIUM_PATH` to use an existing Chromium executable. The example fixtures are synthetic. Do not present fixture-generated content as model inference.

## Extension boundaries

- Source import and normalization: `crates/rev-core/src/main.rs` and `contracts/domain.v1.schema.json`. Zod definitions in `src/lib/contracts.ts` generate the schema with `pnpm contracts:generate`; Rust tests validate cross-language outputs against it.
- Provider adapters and evidence validation: Rust core `generate` / `validate_candidates`.
- Persistence and state transitions: `src/lib/server/store.ts` and `service.ts`.
- UI: `src/components/HandoverWorkspace.tsx`.

Keep source permissions independent from model predictions. Preserve reviewer approval and never treat matching evidence as proof of a claim. Add positive and negative tests for changes. Avoid logging source text and secrets.

The maintainers have not yet selected a project license. Contact the owner before making assumptions about reuse or submitting contributions.
