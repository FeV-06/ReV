---
name: rev-round3
description: Write or review ReV's CodersInPune Round 3 README, final PDF, form answers, judge walkthrough, and evidence of the three Round 2 commitments. Use for submission readiness and public-link checks.
---

# ReV Round 3 submission

Write for a judge who will open the product alone. Explain the user task first, then the exact clicks and visible result. Put setup details and internal architecture after the walkthrough. Use plain English and one feature per line in the form's feature list.

## Ground the claims

- Use the actual Round 2 submission as the source of truth. The repo copies are [the execution plan](../../../ROUND2_EXECUTION_PLAN.md) and [the technical report](../../../docs/ROUND2_TECHNICAL_REPORT.html). Check section 2.5 of the plan and section 6 of the report. Preserve the original scope, order, and any quantified promise.
- Cover the same three commitments in order: **Laya commit/AST triage**, **authenticated team sync and Supabase row-level security**, and **multi-contributor bus-factor and knowledge-churn heatmap**. For each, write what was promised, what shipped, how a judge can see it, and any part still missing. Keep other improvements in their own form field.
- Check current code, the public revision, and the live workflow separately. Describe features precisely as live and verified, demo-only, implemented locally, partial, or pending. For example, the sample handover can demonstrate review without proving live inference. A Laya status that says zero skipped proves evaluation ran and does not measure savings. A passing local security test does not show team access works on the deployed instance. A Git ownership and churn score does not imply test coverage was included.
- Include the test environment, what was exercised, observed results, fixes, and known limitations. Link to relevant code or tests and provide steps a judge can reproduce. Report measured speed, accuracy, and savings only with the comparison and data that support the numbers.
- Disclose significant AI tools and reusable work as applicable, including what those tools did. Keep real project data, private account details, secrets, and provider keys out of public material. If a public demo needs login, document the official demo access using an isolated sample account and sample data.

## Prepare and verify the submission

1. Check the [official event page](https://wecodecoders.in/events/codersinpune), the [Round 3 form link](https://forms.gle/FxhT5Z1NupvGTGSw6), and organizer updates the team received. The published close is **16 November 2026 at 11:59 p.m. IST**. The team confirmed that its leader will submit once, as directed by the provided Round 3 form. The general event page says every participant files separately. If the instructions change or an organizer clarification is available, record it. Keep exact earlier-round team details from the team's records.
2. Prepare the deployed product link, public repository at the final revision, and final PDF with Drive sharing set to **Anyone with the link → Viewer**. Use the final URLs in the README, PDF, and form. Keep draft placeholders visibly marked until the real artifacts exist.
3. Open each exact URL in a signed-out private window or clean browser context. On the product, complete the judge's main flow using the documented demo access. Open the source tree and compare the deployed and public revisions when possible. Open the PDF and confirm it is the final version. Record which checks passed and which were blocked. Verify access and the actual workflow separately.
4. Draft the rest of the form from the evidence: working live features, architecture and the hardest implementation problem, testing, the three commitments, other work since Round 2, and an ordered roadmap. Use [How ReV works](../../../docs/HOW_REV_WORKS.md) for the flow. Keep the roadmap concrete about audience, next step, and dependencies.
5. Leave confirmations and the declaration for the authorized submitter. Preserve the distinction between preparing answers and submitting them. A public repository check alone does not show that local work has been pushed or that the other links work.
