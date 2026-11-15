# ReV

ReV helps engineers hand a project to the next maintainer. It turns selected local Git, GitHub, and Slack evidence into a draft with quotes the reviewer can check. The reviewer can edit claims, ask the departing engineer for missing context, and approve a Markdown handover.

## Try the handover

1. Open ReV and choose **Instant Demo** in the handover studio. It uses sample data and works without a model account.
2. Select a few sources, confirm the recipient can see them, and generate a draft.
3. Open a quote under a claim to see the evidence. Edit or exclude anything that the successor does not need.
4. Save the review, approve the current version, and download the Markdown.

For a real draft, switch to **Live Engine**, choose a local checkout or GitHub under **Git source**, and configure a model. Try a small set of sources first so you can compare the claims to the quotes. A `validated_reference` badge means ReV found the quote in the source. The reviewer decides whether it supports the claim.

Read [How ReV works](docs/HOW_REV_WORKS.md) for a diagram and a plain-English explanation of the tools. [Verification notes](VERIFICATION.md) record the earlier Round 2 checkpoint. For Round 3, use the [three original commitments](ROUND2_EXECUTION_PLAN.md#25-the-three-commitments-for-round-3) and verify the current product before using it as submission evidence.

## Requirements

- Node.js 22 or newer, pnpm (version pinned in `package.json`), Rust and Cargo.
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

Open [ReV on localhost](http://127.0.0.1:3077) and follow the walkthrough above.

You can optionally specify the departing contributor's GitHub username (without `@`) and the incoming person's target role. Imported GitHub records with a directly linked matching account are marked in the source list; records with no account association are not guessed. This does not yet collect the contributor's complete history or resolve Git/Slack aliases. A role is context for generation, not an access permission; the operator still chooses and authorizes every source.

For a production-style local build, run `pnpm build` and then `pnpm start` in the second terminal with the daemon running. Both processes use the same `REV_DATA_DIR`, which defaults to `.rev-data` under the repo. The daemon listens on loopback port `3078`. See [Daemon lifecycle](docs/DAEMON_LIFECYCLE.md) for capture, startup, and lock recovery. Keep the local development instance private and use sample data in public demos.

## Start a handover from a cloned project

After installing ReV and building its Rust core, run `node /absolute/path/to/ReV/scripts/open.mjs` from inside the project checkout. The launcher opens the local dashboard with that checkout selected.

1. Enter the departing person's GitHub username or local Git author name. The incoming role is optional.
2. Import the detected checkout and any project Slack channels selected in ReV.
3. Optionally enter what the incoming person is taking over. ReV suggests paths from matching Git activity when available. Confirm the responsibilities with the team and select the evidence that can be shared.
4. Generate and review **Start here** and any **Day 1 follow-ups**. The approved Markdown puts those cited actions first. If the draft has no supported first action, ReV prompts the reviewer to confirm one with the team.

## Connect project sources

- **Local Git.** Pick a registered checkout under **Git source**, or use the default checkout. Set `REV_GIT_DIR` in `.env.local` to change the default. ReV reads up to 100 commits reachable from the checkout's current HEAD. Use the exact name from the local Git history to filter by contributor.
- **GitHub.** Choose the GitHub option under **Git source** and enter `owner/repo`, or click an example. GitHub also provides pull requests and comments. If it hits a rate limit, you can start a fresh import from a local clone to read commit history.
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

GitHub caps the history and patches it fetches. Slack accepts standard channel/day JSON in a ZIP (up to 10 MiB compressed) and authorized live channels. **Select all** works for runs with up to 500 sources. If the provider returns an incomplete draft, ReV retries with a shorter reply request and may shorten the evidence input. Select fewer sources if the provider still cannot finish. The operator confirms what the recipient can access and reviews the claims before sharing.

## Try Laya commit triage

Laya checks selected local Git and GitHub commits for changes a successor needs to know about. It uses commit messages, changed paths, selected AST or patch evidence, and the takeover scope when available. It can skip routine edits such as formatting and generated-file churn. ReV keeps the original source records available for review.

From the ReV checkout in PowerShell, set up Python 3.11 and download the model using a sample message:

```powershell
$layaEnv = Join-Path $env:LOCALAPPDATA 'ReV/laya-venv'
py -3.11 -m venv $layaEnv
$layaPython = Join-Path $layaEnv 'Scripts/python.exe'
& $layaPython -m pip install 'laya==0.4.29' --extra-index-url https://download.pytorch.org/whl/cpu
'["fix typo in docs"]' | & $layaPython scripts/laya-triage.py
```

Set `REV_LAYA_PYTHON` in ReV's `.env.local` to the absolute path of that `python.exe`, then restart ReV and any running ReV daemon. Draft generation uses the cached checkpoint in offline mode.

1. Use a real local Git checkout with two commits by the same author. In one commit, fix a typo in `README.md` with the subject `fix typo in docs`. In the other, change code or record an important decision.
2. Import and select both commits, then generate a draft with your configured model. The review screen reports how many commits were skipped and shows up to five of their subjects. Both commits remain in Sources. ReV keeps uncertain and truncated results and protects changes with explicit signals such as permissions, migrations, and open work.
3. Point `REV_LAYA_PYTHON` at a missing executable and restart. Repeat the draft generation. The review screen should report that classification was unavailable, and generation should proceed with both commits.

Run `pnpm exec vitest run tests/laya-triage.test.ts` to exercise the filtering and fallback with controlled classifier responses. To measure the benefit, label a set of real commits by hand and generate the same handovers with Laya enabled and disabled. Compare important commits missed, input size, and total elapsed time including Laya.

## Verify

```sh
cargo fmt --all --check
cargo build --workspace
pnpm verify
```

Browser test (requires Chromium and a running ReV server): `pnpm exec playwright install chromium` followed by `pnpm exec playwright test`. To use an existing Chromium executable instead, set `REV_CHROMIUM_PATH` to its path. With an explicitly configured provider, opt into the live inference smoke test with `REV_TEST_LIVE=1 pnpm exec playwright test tests/live-provider.spec.ts`; it sends only the synthetic fixture to that provider.

Set `REV_TEST_LIVE_GITHUB=1` to include the live Blinky import in `pnpm exec vitest run tests/blinky-live.test.ts`. The live check needs GitHub API access and may hit its rate limit. The default run still checks local Git ingestion and capture.

## Data and privacy

Runs are stored in `.rev-data/` by default; `REV_DATA_DIR` changes the local storage path. The Delete run button removes its stored record. It cannot recall a Markdown file already downloaded. Back up or protect the local data directory using operating-system controls. Tokens and model prompts are not deliberately logged or stored in run records; source snapshots and generated handovers are stored locally.

## Project layout

- `crates/rev-core/`: GitHub/Slack adapters, provider requests and citation checks.
- `src/daemon/`: local daemon entrypoint and authenticated API; `src/lib/server/` contains PGLite storage, orchestration and the dashboard's daemon client.
- `src/lib/contracts.ts`, `contracts/`: shared data shapes.
- `src/components/`: local review interface.
- `editors/vscode/` and `src/mcp/`: editor and AI-client entry points for ReV workflows.
- `fixtures/`: fictional data; fixture generation is not real AI inference.
- `tests/`: unit and browser checks.

See `CONTRIBUTING.md` and `ROADMAP.md`. A license has not been chosen; do not assume a license has been granted. A private security reporting contact remains to be configured before public distribution.
