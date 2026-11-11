# ReV: Round 2 Execution & Submission Plan

**Event:** CodersInPune Hackathon — Round 2: The Build  
**Deadline:** Wednesday, November 11, 2026  
**Target Submission Platform:** Google Form (`https://forms.gle/gyRiHtQT3AnC3MdV6`)  
**Project:** ReV (Relaying to Everyone Virtually) — Evidence-Backed Developer Handover Engine  

---

## 1. Architectural Strategy (Option A: Live Self-Hosted Cloudflare Tunnel)

To satisfy the strict Round 2 criteria (*"The deployed, working product — not a repo, not a video. It must load for anyone who opens it"*):

1. **Next.js Web Dashboard (:3077):**
   - Serves the role-tailored Material 3 Expressive UI.
   - Exposed publicly via Cloudflare Tunnel on `https://rev.fev06.xyz` (or `fev06.xyz`).
   - Patched with `REV_PUBLIC_HOST` support to allow external HTTPS origins without breaking CSRF protection.
2. **Local Headless Daemon (:3078):**
   - Listens strictly on `127.0.0.1:3078`. Never exposed directly to the internet.
   - Owns PGlite embedded database in `.rev-data/pglite/`.
   - Spawns the compiled Rust binary `crates/rev-core` for Tree-Sitter AST parsing and Git operations.
3. **Local Model Provider (OmniRoute :20128):**
   - Bound to `127.0.0.1:20128`.
   - Model: `antigravity/gemini-3.8-flash-high`.
   - Serves real-time synthesis for public GitHub repos and departure interviews with high reasoning depth.
4. **Ingestion Safeguards:**
   - Public GitHub API access fortified with `GITHUB_TOKEN` in `.env.local` to lift the 60 req/hr IP rate limit to 5,000 req/hr.
   - "Try sample project" synthetic fixture kept active as a zero-latency fallback for quick judge reviews.

---

## 2. Form Submission Field Responses

### 2.1 The List of Completed Features
* Material 3 Expressive Role-Tailored Workspace: Separate Admin/Lead Creation Studio and Successor Onboarding Portal.
* Screen-Advancing 4-Stage Creation Wizard: Guided step-by-step handover construction with smooth transitions.
* Tree-Sitter AST Code Symbol Extraction: Multi-language parsing (TypeScript, Rust, Python fallback) mapping changed functions, types, and structs to Git commits.
* Grounded Departure Interview Generator: Synthesizes concrete architectural gap questions by comparing commit history against documentation.
* Successor Q&A Assistant: Interactive Q&A engine citing verbatim, verified source excerpts from commits and interview transcripts.
* Successor Priority Day-1 Onboarding Checklist: Interactive verification tasks with progress tracking and persistent local state.
* Local Data Sovereignty & Storage Toggle: Switch between local PGlite Wasm storage and remote cloud synchronization.
* Multi-Source Scope Filtering: Granular opt-in selection of Git commits, PRs, documentation, and Slack messages with instant invalidation upon scope tampering.
* One-Click Verifiable Markdown Export: Downloadable, publication-ready `HANDOVER.md` with cited evidence.
* Dual-Bundle VS Code Extension: Native IDE integration bridging workspace telemetry, status bar items, and a dedicated Team Sync panel.

### 2.2 Technology and Implementation Details
* **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Material 3 Expressive CSS custom properties.
* **Storage & Local State:** PGlite (embedded WebAssembly Postgres) for local-first zero-install relational storage.
* **Core Native Engine:** Rust (`crates/rev-core`) utilizing Tree-Sitter (`tree-sitter-typescript`, `tree-sitter-rust`), `reqwest` for streaming GitHub APIs, and custom citation substring verification logic.
* **AI & Inference:** OpenAI-compatible LLM layer via OmniRoute utilizing `antigravity/gemini-3.8-flash-high`.
* **Architecture:** 3-tier local-first model separating the client UI, a background systemd/node daemon, and native core CLI processes.

### 2.3 What Changed From Original Proposal, and Why?
1. **Three-Layer System Architecture:** Shifted from a single monolithic dashboard to a decoupled 3-tier architecture (Headless Daemon, Web Studio, and VS Code Extension) to seamlessly integrate into daily developer workflows.
2. **Team Cloud Sync & Sovereignty Toggle:** Added Supabase synchronization to enable multi-developer team handovers, moving beyond single-machine PGlite while retaining local-first data sovereignty.
3. **Interactive Departure Interviews & Cited Q&A:** Expanded beyond static text generation to include proactive interview generation that interrogates departing engineers on undocumented decisions and enables successors to ask cited questions.
4. **Material 3 Expressive Redesign:** Overhauled the original single-page form into a dual-portal experience (Team Lead Studio vs. Successor Onboarding Reader) following Google's M3 Expressive design tokens.

### 2.4 What Does NOT Work Yet? (Transparent Disclosure)
1. **Multi-Tenant Route Authorization:** Team mode (`REV_TEAM_MODE=1`) is currently undergoing security hardening; legacy bulk sync fails closed (HTTP 403) to prevent unauthenticated data leaks until per-user RLS routes are complete.
2. **Live Slack App Authorization:** Live Slack ingestion requires pre-configured Slack Bot OAuth tokens; synthetic zip export ingestion is provided as the stable alternative.
3. **Unauthenticated GitHub Rate Bounds:** Ingesting large public GitHub repositories without a configured personal access token is subject to GitHub's 60 req/hr IP rate limit.
4. **Deep Reasoning Latency:** Full LLM synthesis on deep reasoning models (`gemini-3.8-flash-high`) takes 45–90 seconds per run over large symbol trees; progress indicators are provided, but instant execution requires the synthetic fixture.

### 2.5 The Three Commitments for Round 3
1. **Laya Semantic Classifier Integration for Commit/AST Triage:**  
   Implement a specialized classifier pipeline to evaluate whether an AST symbol or commit represents an intentional architectural pivot versus cosmetic churn, pruning noise before LLM synthesis.
2. **Frictionless Multi-Tenant Team Sync & Supabase RLS:**  
   Complete the end-to-end authenticated team mode with verified member sessions, private-by-default owned runs, and frictionless one-click lead sharing.
3. **Multi-Contributor Bus-Factor & Knowledge Churn Heatmap:**  
   Deliver an interactive visual risk heatmap identifying repository modules with critical knowledge concentration (combining Git blame ownership, commit churn, and test coverage gaps via `crates/rev-core`).

---

## 3. Step-by-Step Execution Sequence

- [x] **Task 1: Plan Documentation** (`ROUND2_EXECUTION_PLAN.md` created)
- [ ] **Task 2: Security Middleware Patch** (Update `src/lib/server/request-security.ts` for `REV_PUBLIC_HOST` / HTTPS)
- [ ] **Task 3: Environment Setup** (Link `.env.local` to `ReV-team-sync` with OmniRoute + GitHub token)
- [ ] **Task 4: Compilation & Build** (`cargo build --workspace`, `pnpm daemon:build`, `pnpm vscode:build`)
- [ ] **Task 5: Tunnel & Live Service Verification** (Verify Cloudflare tunnel and local Next.js connectivity)
- [ ] **Task 6: Git Synchronization** (Merge and push verified commits to `origin/main` on GitHub)
- [ ] **Task 7: Round 2 PDF Technical Report** (Compile and deliver the final submission document)
