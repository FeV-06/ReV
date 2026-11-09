# What Leaves With Them

[What Leaves With Them](https://github.com/retailbox-automation/what-leaves-with-them) is an MIT-licensed departure analysis project. Its demo uses a seeded FalkorDB graph of people, systems, and decisions. It traces dependencies, models removing a person, and produces suggested handoff questions. The README gives local setup instructions using Python and Docker.

**ReV application.** Use the graph walkthrough to study how to explain why an area is at risk and what evidence supports that conclusion. Separate direct ownership evidence from activity such as commits. The sample graph has explicit relationships, while ReV would need to derive or confirm those relationships from real sources.

**Evaluation.** Seed an example with a departing engineer, a service with no documented backup owner, and a service with an active second maintainer. Check whether each handover surfaces the unsupported service, avoids overstating the second risk, and gives the successor a source-backed first action.

[Local setup](https://github.com/retailbox-automation/what-leaves-with-them#run-it-locally) · [Graph walkthrough](https://github.com/retailbox-automation/what-leaves-with-them#what-the-graph-does-here)
