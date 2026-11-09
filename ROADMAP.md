# Roadmap

For the event build, use the [hackathon scope](docs/hackathon-scope.md). The roadmap below tracks future work.

The current MVP is on-demand and single-operator. Future areas include:

1. Benchmark Laya and alternative classifiers on representative held-out handover data before selecting or fine-tuning a model.
2. Add automated source permission mapping, authenticated recipients and revocation before multi-user hosting.
3. Model evidence-supported relationships and provide a causal graph; do not infer causality from timestamps alone.
4. Extend source ingestion to code changes, PR discussions and additional tools.
5. Add reviewable divergence detection, bus-factor insights and targeted exit questions.
6. Add continuous incremental processing after the on-demand workflow is reliable.
7. Implement and test a Supabase adapter and data migration separately from the local PGLite store.

Please open a discussion before starting major work. These are future ideas, not current functionality.
