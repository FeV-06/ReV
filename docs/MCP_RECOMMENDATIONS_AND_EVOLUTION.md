# ReV Model Context Protocol (MCP) Analysis, Recommendations & Roadmap

This document captures the forensic evaluation of the **ReV MCP Server (`src/mcp/`)**, actionable recommendations to resolve immediate runtime blockers, and the expansion roadmap for autonomous AI coding agents operating alongside ReV's desktop daemon and VS Code extension.

---

## 1. Executive Summary & Agent Ergonomics Rating

* **Evaluated Component:** `@modelcontextprotocol/sdk` server integration (`src/mcp/index.ts`, `server.ts`, `client.ts`, `tools/`).
* **Evaluation Scenario:** An autonomous AI coding agent (e.g. Claude Code, Cursor, Hermes, Roo Code) operating in a developer workspace with ReV installed.
* **Overall Ergonomics Score:** **7.5 / 10**

### Score Breakdown
* **Persona Separation & Tool Taxonomy (9.0/10):** Distinct suites for `admin`, `departing`, and `successor` cleanly partition role authority and reduce tool lookup confusion.
* **Citation Grounding & Evidence Integrity (9.5/10):** Native substring quote verification prevents hallucinated handover claims from entering agent context.
* **Closed-Loop Successor Q&A (9.0/10):** Unanswered questions automatically escalate to open gap questions for the departing maintainer.
* **Error Handling & Protocol Stability (8.5/10):** Tools catch exceptions without crashing stdio.
* **Deployment & Config Ergonomics (5.5/10):** Platform mismatches in `.cursor/mcp.json` and single-directory token resolution cause runtime failure when not running from the ReV repo root.
* **End-to-End Workflow Completeness (6.0/10):** Critical workflow links are missing (no tool to view unselected sources, trigger LLM generation, or approve drafts).

---

## 2. Immediate Actionable Fixes

### Fix 1: Multi-Location Daemon Configuration Discovery (`src/mcp/client.ts`)
* **Problem:** `resolveDaemonConfig()` looks strictly at `process.env.REV_DATA_DIR || join(homedir(), '.rev-data')`. If a user starts the daemon locally without setting `REV_DATA_DIR`, the daemon defaults to `.rev-data` relative to `cwd`. The MCP client fails to find `daemon.token` and falls back to unauthenticated requests, triggering HTTP 401.
* **Solution:** Resolve across all standard candidate locations in order:
  1. `process.env.REV_DATA_DIR`
  2. `path.join(process.cwd(), '.rev-data')`
  3. `path.join(homedir(), '.rev-data')`

### Fix 2: Cross-Platform Cursor Configuration (`.cursor/mcp.json`)
* **Problem:** `.cursor/mcp.json` specifies `"args": ["dist/mcp/index.js"]` and `"REV_DATA_DIR": "%USERPROFILE%/.rev-data"`. On Linux/macOS, `%USERPROFILE%` is not expanded and relative `dist/mcp/index.js` fails when opened in any target project other than ReV itself.
* **Solution:** Use platform-agnostic environment expansion and expose an npm binary entrypoint (`npx @rev/mcp` or absolute extension path).

### Fix 3: Close the Admin Handover Lifecycle Gap
Currently, an admin agent can run `rev_admin_create_project` and `rev_admin_configure_scope`, but:
1. **Cannot view available evidence:** There is no tool to fetch candidate commits, AST symbols, or documentation artifacts (`rev_admin_get_available_sources`), making it impossible for the agent to know which IDs to pass into `selectedSourceIds`.
2. **Cannot trigger generation:** There is no tool to trigger synthesis (`rev_admin_generate_handover`).
3. **Cannot approve the final draft:** There is no tool to sign off on the review items (`rev_admin_approve_handover`).

---

## 3. Tool Matrix: Current vs. Proposed Complete Suite

| Persona | Current Tools | Proposed New / Enhanced Tools |
| :--- | :--- | :--- |
| **👑 Admin** | `rev_admin_create_project`<br>`rev_admin_configure_scope`<br>`rev_admin_list_active_projects`<br>`rev_admin_get_project_roster`<br>`rev_admin_select_slack_channels`<br>`rev_admin_get_bus_factor_risk` | **`rev_admin_get_available_sources`** (fetch unselected artifacts & AST symbols)<br>**`rev_admin_generate_handover`** (trigger deep LLM synthesis)<br>**`rev_admin_approve_handover`** (sign off with confirmation)<br>**`rev_admin_trigger_scan`** (trigger daemon incremental capture) |
| **✎ Departing** | `rev_departing_list_projects`<br>`rev_departing_get_questions`<br>`rev_departing_submit_answer` | **`rev_departing_synthesize_interview`** (trigger gap detection for interview)<br>**`rev_departing_review_draft`** (preview candidate draft items) |
| **👤 Successor** | `rev_successor_get_project_info`<br>`rev_successor_download_artifacts`<br>`rev_successor_raise_question` | **`rev_successor_update_checklist`** (mark Day-1 tasks in-progress/complete)<br>**`rev_successor_inspect_module`** (query ownership & architectural churn for a specific file) |

---

## 4. Next Steps
See brainstorm options for structuring the MCP server evolution.
