# Round 2: ReV submission notes

## The product

ReV turns authorized GitHub repository activity and Slack exports into an on-demand, evidence-linked handover. The local operator chooses the material the recipient may see, generates a draft, reviews the evidence, edits or excludes items, and explicitly approves a Markdown export.

## How to demonstrate

1. Start the app using `README.md` and open http://127.0.0.1:3077.
2. Choose **Try synthetic example**. Select the fictional engineering sources, leaving the leadership-only source unselected.
3. Confirm recipient access and generate. The sample clearly labels its output as deterministic fixture content, not live model inference.
4. Inspect citations, exclude an item, save, approve, and download the handover. Change the source selection and show that approval is invalidated.
5. To demonstrate actual AI generation, configure a trusted provider in `.env.local`, import the synthetic Slack ZIP under `fixtures/`, consent to sending the selected synthetic text, and generate. Do not claim the fixture button uses AI.

## Architecture and significant tools

- Next.js/React + TypeScript for the UI and server; Rust for source ingestion and model-provider calls.
- PGLite stores snapshots, run state and approved revisions locally. Zod generates the shared JSON Schema; Rust tests exercise compatibility.
- GitHub REST API for the first page of commits and PRs; Slack export ZIP parsing. Model provider supports OpenAI-compatible and Anthropic-compatible APIs.
- CI, unit tests and Playwright checks are included. AI coding assistance was used; disclose other tools, model names, datasets and external services actually used for the submission.

## Known limitations

- Local single-operator app; manual authorization, not source ACL verification. Not suitable for internet exposure or multi-user use.
- GitHub import uses metadata and messages, not source diffs, PR comments or complete history. Slack supports channel/day JSON exports only.
- AI claims can be wrong even if an evidence quote matches. A human must review; model quality varies. No live Anthropic test has been performed.
- No classifier, causal graph, divergence detector, bus-factor heatmap, continuous monitoring, or Supabase sync yet.
- The app requires user-configured provider credentials and access; the fixture demonstration does not require them.

## Proposed Round 3 improvements — only commitments once your team submits them

1. Evidence-supported causal graph and interactive decision timeline.
2. Gap-finding exit questions and stronger contradiction review.
3. More secure role-based sharing and source-permission integration.

These are proposals, not implemented features or confirmed organizer submissions. Select three realistic improvements with the team before submitting.
