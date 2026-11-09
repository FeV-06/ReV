# ReV hackathon scope

Source: Knowledge Handover Problem Statement, pages 1–7. The brief requires an end-to-end handover and leaves the choice of users, integrations, and interface to the team.

## One scenario

An engineer is leaving a small software team. A maintainer prepares an evidence-linked handover that tells the incoming engineer what to do first. Use the existing local browser workspace for the judge demonstration.

| Required step | What the judge should be able to do |
| --- | --- |
| Connect | Select a departing engineer and import approved Git activity and relevant Slack messages. Provide a synthetic example for judges without credentials. |
| Reconstruct | See key decisions, open work, ownership where supported, risks, dependencies, and a concrete first action. |
| Verify | Inspect the source behind important claims and see where evidence is missing, uncertain, or conflicting. |
| Review | Correct or exclude an item and explicitly approve the resulting draft. |
| Handover | Export an approved Markdown plan for the successor, with cited next steps first and only material the reviewer has confirmed the recipient may receive. |

The local reviewer controls source selection and approves release. Describe this as reviewer-controlled sharing. Automated GitHub and Slack permission mapping and authenticated recipient access are separate roadmap work.

## Scope boundary

Prioritize work that makes the five steps reliable and easy to demonstrate. Test a complete handover, a partial or failed import, a claim without enough evidence, and exclusion of a source the recipient may not receive. Use synthetic, public, authorized, or anonymized material in the demo.

Defer a VS Code extension, public multi-user hosting, additional integrations, continuous indexing, a company-wide knowledge graph, and a full interview platform. Existing research notes are references. Flamekeeper is useful for focused gap questions and review. What Leaves With Them is useful for explaining a risk from evidence. Neither expands the submission scope.

## Round deliverables

Round 2 needs an accessible working demo, the repository, an updated technical write-up, testing evidence, and three substantial Round 3 commitments. Round 3 needs evidence that the three submitted commitments were delivered, along with the final demonstration, testing notes, and responsible-design explanation. Check [the Round 2 notes](../ROUND2.md) and confirm the actual submitted commitments with the team before changing them.

Record reused material, external services, and significant AI assistance. Use the organizer's announced build window, deadlines, and submission forms for event-specific requirements.
