# ReV: Project Overview & Architecture Guide

## 1. Executive Summary

**ReV** is an on-demand, local-first workspace designed to turn fragmented engineering communications and code changes (local Git repositories, GitHub commits/PRs/issues, and Slack discussions) into an **evidence-linked project handover**. 

It specifically addresses offboarding/handovers by:
1. Importing raw communications and code changes from project sources.
2. Allowing a reviewer/operator to filter what the recipient is authorized to see.
3. Generating a structured draft with exact source citations (via LLMs or offline synthetic fixtures).
4. Providing a human-in-the-loop review workflow where unverified edits invalidate previous approvals.
5. Exporting an approved, verifiable Markdown handover document.

---

## 2. System Architecture

The project is built as a hybrid **Next.js + Rust + PGlite** application:

```
┌────────────────────────────────────────────────────────┐
│                   Next.js Frontend                     │
│  (React 19, Tailwind/CSS Tokens, 3 Personas / Workspaces)│
│  - Admin / Team Lead: Studio Wizard & Approval Hub     │
│  - Departing Teammate: Departure Interview Q&A Flow    │
│  - Successor Developer: Reader, Day-1 Tasks & Assistant│
│  - API Routes (/api/runs, /api/slack, /api/settings)   │
└──────────────────────────┬─────────────────────────────┘
                           │ IPC / Native Bindings / HTTP
┌──────────────────────────▼─────────────────────────────┐
│                 Node.js / Server Core                  │
│  - PGlite (Wasm-based local PostgreSQL in .rev-data/)  │
│  - Local orchestrator & lifecycle manager              │
│  - Local Git & Document Ingestion (commits, docs)      │
│  - Settings persistence & env bridge to rev-core       │
│  - Interview orchestration & gap review resolution     │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 Rust Core (crates/rev-core)            │
│  - GitHub & Slack data adapters & rate-limit handling  │
│  - Model provider abstraction (OpenAI / Anthropic)     │
│  - Exact quotation & citation validation engine        │
│  - `prepare_interview` & `answer_successor` operations │
└────────────────────────────────────────────────────────┘
```

### Core Technologies
- **Frontend**: Next.js (App Router), React 19, TypeScript, CSS custom properties / responsive tokens.
- **Backend / Storage**: Node.js, [PGlite](https://pglite.dev/) (embedded Postgres running in WebAssembly locally, storing database files in `.rev-data/` or `REV_DATA_DIR`).
- **Core Engine (Rust)**: Located in `crates/rev-core/`. Handles connector adapters, citation quote verification, and model payloads.
- **Testing & Evals**: Vitest, Playwright (end-to-end browser tests), Cargo test, Laya classification evaluation pilots (`evals/classification/`).

---

## 3. Data Flow & Security Model

1. **Source Ingestion**:
   - **Local Git**: Reads up to 100 reachable commits from HEAD.
   - **Local Docs**: Scans workspace markdown/text documentation (`.md`, `.mdx`, `.txt`, `.rst`, architecture specs) via `importLocalDocs()`, tagging them as `git_document` artifacts for comparison against commit histories.
   - **GitHub**: Reads commits, pull requests, review comments, and issue comments up to pagination bounds (up to 200 items), with contributor-filtered commit fetches.
   - **Slack**: Connects via OAuth PKCE or imported zip files (reads recent messages from up to 5 joined channels).
2. **Scope Selection & Recipient Guardrails**:
   - Sources are strictly opt-in. Text excluded by the reviewer is **never** sent to LLM providers or included in graph scope.
   - Any server-side scope or source modification immediately marks existing drafts/approvals invalid.
3. **Generation & Verification**:
   - Can use offline synthetic fixtures (zero-cost, offline development) or live OpenAI/Anthropic-compatible endpoints.
   - Strictly enforces quote matching: all claims generated must cite direct verbatim substrings from authorized source artifacts.
4. **Departure Interview Subsystem**:
   - Lead triggers `prepare_interview` via `rev-core` to synthesize evidence-backed questions on unclarified code or gaps.
   - Departing teammates access their focused workspace (`<DepartingWorkspace />`) to answer flagged questions.
   - Submissions are logged as `review_answer` artifacts, presented for review in Step 3, and merged into the approved bundle upon signoff.
5. **Successor Handover Assistant**:
   - Onboarding engineers ask natural language queries against approved runs (`/v1/runs/:id/ask` or `/api/runs/[id]`).
   - Powered by `answer_successor` in `rev-core`, enforcing exact citations from approved sources and auto-logging unanswered questions as open gaps for team review.
6. **Graph & Gap Detection (Experimental / Post-MVP)**:
   - Stores review events in an append-only `graph_events` table.
   - Proposes contradiction/divergence candidates (requiring 2+ corroborating sources) and identifies unverified gaps to present targeted questions.

---

## 4. UI Implementation Plan Analysis

### Is there a UI Implementation Plan?
**Yes.** There is an explicit and detailed UI implementation plan documented in:
[docs/material-3-expressive-implementation-plan.md](file:///c:/users/khanna/projects/ReV/docs/material-3-expressive-implementation-plan.md).

### Summary of the UI Plan:
The UI plan adopts Google's **Material 3 Expressive** design system while retaining ReV's branding (deep green palette, serif display typography, tonal containers):

1. **Milestone 1: Theme & Entry Screen Restyling**
   - Define custom CSS tokens in `src/app/globals.css` for primary/tonal/outline containers.
   - Establish typography hierarchy (serif headings, sans-serif body & evidence).
   - Replace the static progress display in [HandoverWorkspace.tsx](file:///c:/users/khanna/projects/ReV/src/components/HandoverWorkspace.tsx) with an accessible 4-stage stepper (`Import` ➔ `Select sources` ➔ `Review` ➔ `Export`).
2. **Milestone 2: Source Selection & Review Experience**
   - Tinted selectable rows with source counters and authorization guardrail cues.
   - Structured claim cards: claim text, verification badges, tonal citation insets, and editing controls.
   - Dynamic button emphasis based on run eligibility (e.g., Save Review, Approve Current Revision, Download Markdown).
   - Micro-transitions with full `prefers-reduced-motion` compliance and accessibility (`aria-current="step"`, high-contrast).
3. **Milestone 3: Verification & Responsive Hardening**
   - Full Playwright accessibility checks and cross-device responsive verification (320px mobile up to desktop).

### Additional UI Items in the Systems Checklist:
In addition to the styling plan, [REV_SYSTEMS_CHECKLIST.md](file:///c:/users/khanna/projects/ReV/REV_SYSTEMS_CHECKLIST.md) details planned UI feature integrations:
- **Interactive Timeline / Evidence Graph**: Visualizing causal links and evidence previews (proposing `@xyflow/react`).
- **Citation Repair UI**: Allowing reviewers to attach, verify, or repair broken citations directly in the browser.
- **Granular Redaction UI**: Inline phrase replacement and redaction controls.
- **Exit Gap Answering UI**: Frontend forms to resolve missing handover context.

