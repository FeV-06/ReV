# ReV

ReV is a local, on-demand workspace for turning selected GitHub and Slack activity into an evidence-linked project handover. A reviewer selects what a recipient may receive, checks the draft, and approves a Markdown export.

**Early prototype; release gate not yet met.** See `VERIFICATION.md` for outstanding work. This is not multi-user software and does not automatically verify GitHub/Slack recipient access. The local operator is responsible for authorisation and review. Never expose this development server to the internet or use real confidential data without permission.

## Requirements

- Node.js 22 or newer, pnpm 11, Rust and Cargo.
- GitHub access for live repository imports. A read-only `REV_GITHUB_TOKEN` is optional for public repositories and required for private ones.
- An OpenAI-compatible or Anthropic-compatible model endpoint for real generation. The synthetic example requires no account or model.

## Start locally

```sh
pnpm install --frozen-lockfile --ignore-scripts
cargo build --workspace
pnpm dev
```

Open **http://127.0.0.1:3077**. Choose **Try synthetic example**, select sources, confirm recipient authorisation, generate the clearly marked fixture draft, review, approve, and download Markdown.

For a production-style local build: `pnpm build && pnpm start`. The app binds to loopback only in the supplied scripts. Do not expose it with a tunnel.

## Real generation

Copy `.env.example` to `.env.local`, then configure:

- `REV_MODEL_PROVIDER=openai` or `anthropic`.
- `REV_MODEL_BASE_URL`: API base, e.g. `http://127.0.0.1:11434/v1` for a local OpenAI-compatible server or `https://api.anthropic.com/v1`.
- `REV_MODEL_NAME`: model identifier chosen by you.
- `REV_MODEL_API_KEY`: provider key if needed. Never commit `.env.local`.
- `REV_GITHUB_TOKEN`: optional read-only GitHub token.

Restart ReV after changing the environment. The operator must explicitly consent before selected text is sent to the configured provider. Only configure endpoints you trust. The app does not send source data to a model until the recipient scope is selected and confirmed.

GitHub import covers up to the first 100 commits and 100 PRs; it reports pagination/partial failures. Slack accepts standard channel/day JSON exports in a ZIP (10 MiB compressed, 40 MiB declared expanded, 500 messages). Source code, diffs, PR comments, Slack APIs, graph building, automated ACL mapping and continuous monitoring are not implemented. Model inputs are limited to 120 KB; select fewer sources if exceeded. A source quote match validates a reference, not the truth of a claim. Human review is required.

## Verify

```sh
cargo fmt --all --check
cargo build --workspace
pnpm verify
```

Browser test (requires Chromium and a running ReV server): `pnpm exec playwright test`. Set the Chromium executable in `playwright.config.ts` if it differs from `/usr/bin/chromium`. With an explicitly configured provider, opt into the live inference smoke test with `REV_TEST_LIVE=1 pnpm exec playwright test tests/live-provider.spec.ts`; it sends only the synthetic fixture to that provider.

## Data and privacy

Runs are stored in `.rev-data/` by default; `REV_DATA_DIR` changes the local storage path. The Delete run button removes its stored record. It cannot recall a Markdown file already downloaded. Back up or protect the local data directory using operating-system controls. Tokens and model prompts are not deliberately logged or stored in run records; source snapshots and generated handovers are stored locally.

## Project layout

- `crates/rev-core/`: GitHub/Slack adapters, provider requests and citation checks.
- `src/lib/server/`: PGlite storage and local orchestration.
- `src/lib/contracts.ts`, `contracts/`: shared data shapes.
- `src/components/`: local review interface.
- `fixtures/`: fictional data; fixture generation is not real AI inference.
- `tests/`: unit and browser checks.

See `CONTRIBUTING.md` and `ROADMAP.md`. License choice and security reporting contact are pending owner decisions; do not assume a license has been granted.
