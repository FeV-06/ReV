# ReV

ReV is a local workspace for turning selected GitHub and Slack activity into an evidence-linked project handover. A separate, manually started Node daemon owns the local store and serves the current handover interface. A reviewer selects what a recipient may receive, checks the draft, and approves a Markdown export.

**Round 2 MVP candidate.** See `VERIFICATION.md` for verified capabilities and remaining limitations. This is not multi-user software and does not automatically verify GitHub/Slack recipient access. The local operator is responsible for authorisation and review. Never expose this server to the internet or use real confidential data without permission.

## Requirements

- Node.js 22 or newer, pnpm 11, Rust and Cargo.
- Git for local checkout imports. GitHub access for remote repository imports. A read-only `REV_GITHUB_TOKEN` is optional for public repositories and required for private ones.
- An OpenAI-compatible or Anthropic-compatible model endpoint for real generation. The synthetic example requires no account or model.

## Start locally (development checkpoint)

```sh
pnpm install --frozen-lockfile --ignore-scripts
cargo build --workspace
pnpm daemon:build
pnpm daemon:start
```

Keep the daemon running in that terminal. In another terminal in the same project directory:

```sh
pnpm dev
```

Open **http://127.0.0.1:3077**. Choose **Try synthetic example**, select sources, confirm recipient authorisation, generate the clearly marked fixture draft, review, approve, and download Markdown.

You can optionally specify the departing contributor's GitHub username (without `@`) and the incoming person's target role. Imported GitHub records with a directly linked matching account are marked in the source list; records with no account association are not guessed. This does not yet collect the contributor's complete history or resolve Git/Slack aliases. A role is context for generation, not an access permission; the operator still chooses and authorizes every source.

For a production-style local build: run `pnpm build && pnpm start` in the second terminal with the daemon already running. Both processes must use the same `REV_DATA_DIR`; by default it is `.rev-data` relative to their working directory. The daemon binds only to `127.0.0.1:3078` and stores its ephemeral local credential in that data directory. Do not expose either process with a tunnel. The daemon does not yet install itself, start automatically, watch directories or support the VS Code extension. If a hard crash leaves a `daemon.lock` directory, startup fails closed: first independently verify no ReV daemon is running and back up the data directory, then inspect the recorded owner before manually removing the stale lock. Automatic crash recovery is not implemented.

## Start a handover from a cloned project

After installing ReV and building its Rust core, run `node /absolute/path/to/ReV/scripts/open.mjs` from inside the project checkout. The launcher opens the local dashboard with that checkout selected.

1. Enter the departing person's GitHub username or local Git author name. The incoming role is optional.
2. Import the detected checkout and any project Slack channels selected in ReV.
3. Optionally enter what the incoming person is taking over. ReV suggests paths from matching Git activity when available. Confirm the responsibilities with the team and select the evidence that can be shared.
4. Generate and review **Start here** and any **Day 1 follow-ups**. The approved Markdown puts those cited actions first. If the draft has no supported first action, ReV prompts the reviewer to confirm one with the team.

## Connect project sources

- **Local Git.** ReV detects the checkout in its working directory. To use a different cloned project, set `REV_GIT_DIR` to its absolute path in `.env.local` and restart. Leave **Use local Git history** checked and click **Import sources**. ReV reads up to 100 commits reachable from the checkout's current HEAD, including their messages and author names. Enter a GitHub repository instead if you want the existing GitHub commit and PR import.
- **Slack.** Open ReV at [localhost:3077](http://localhost:3077), click **Connect Slack**, and authorize read access in Slack. Back in ReV, pick up to five channels you belong to. ReV remembers your selections in the browser and reads up to 15 recent messages per selected channel on each import. Slack ZIP and server-configured bot imports remain available.

To enable Slack sign-in for a local ReV installation, create or configure a Slack app with PKCE enabled. Add `http://localhost:3077/api/slack/callback` as its redirect URL. Add the user scopes `channels:read`, `channels:history`, `groups:read`, and `groups:history`. Set `REV_SLACK_CLIENT_ID` in `.env.local` and restart ReV. The local server stores the authorized connection separately from handover runs in the configured data directory. If your workspace requires app approval, complete that step in Slack.

Imports run when you click **Import sources**. The imported records start unselected for generation and export.

## Real generation

Set these variables in `.env.local` in the ReV folder or export them before starting the daemon (see `.env.example` for names). Exported values take precedence.

- `REV_MODEL_PROVIDER=openai` or `anthropic`.
- `REV_MODEL_BASE_URL`: API base, e.g. `http://127.0.0.1:11434/v1` for a local OpenAI-compatible server or `https://api.anthropic.com/v1`.
- `REV_MODEL_NAME`: model identifier chosen by you.
- `REV_MODEL_API_KEY`: provider key if needed. Never commit `.env.local`.
- `REV_GITHUB_TOKEN`: optional read-only GitHub token.

Restart the daemon after changing its environment. The operator must explicitly consent before selected text is sent to the configured provider. Only configure endpoints you trust. The app does not send source data to a model until the recipient scope is selected and confirmed.

GitHub import covers up to 200 recent commits, PRs, review comments and issue comments per category, plus an additional author-filtered commit fetch when a username is supplied; patch fetches are separately capped. Slack accepts standard channel/day JSON exports in a ZIP (10 MiB compressed, 40 MiB declared expanded, 500 messages) as well as authorized live Slack channels (up to 5 channels, 15 messages each). Full source files, full history, full Slack threads, automated ACL mapping and continuous monitoring are not implemented. An experimental per-run evidence graph and gap/divergence actions exist, but are not the full project graph or a validated contradiction detector. Model inputs are limited to 120 KB; select fewer sources if exceeded. A source quote match validates a reference, not the truth of a claim. Human review is required.

## Verify

```sh
cargo fmt --all --check
cargo build --workspace
pnpm verify
```

Browser test (requires Chromium and a running ReV server): `pnpm exec playwright install chromium` followed by `pnpm exec playwright test`. To use an existing Chromium executable instead, set `REV_CHROMIUM_PATH` to its path. With an explicitly configured provider, opt into the live inference smoke test with `REV_TEST_LIVE=1 pnpm exec playwright test tests/live-provider.spec.ts`; it sends only the synthetic fixture to that provider.

## Data and privacy

Runs are stored in `.rev-data/` by default; `REV_DATA_DIR` changes the local storage path. The Delete run button removes its stored record. It cannot recall a Markdown file already downloaded. Back up or protect the local data directory using operating-system controls. Tokens and model prompts are not deliberately logged or stored in run records; source snapshots and generated handovers are stored locally.

## Project layout

- `crates/rev-core/`: GitHub/Slack adapters, provider requests and citation checks.
- `src/daemon/`: local daemon entrypoint and authenticated API; `src/lib/server/` contains PGLite storage, orchestration and the dashboard's daemon client.
- `src/lib/contracts.ts`, `contracts/`: shared data shapes.
- `src/components/`: local review interface.
- `fixtures/`: fictional data; fixture generation is not real AI inference.
- `tests/`: unit and browser checks.

See `CONTRIBUTING.md` and `ROADMAP.md`. A license has not been chosen; do not assume a license has been granted. A private security reporting contact remains to be configured before public distribution.
