# Onyx

[Onyx](https://github.com/onyx-dot-app/onyx) is a self-hostable AI platform with source connectors. Its GitHub and Slack connector code is a reference for how an application imports and searches engineering knowledge.

**ReV application.** Study incremental ingestion, deduplication, and source links. ReV currently imports bounded snapshots for a specific handover, so check whether a pattern improves that flow before introducing background syncing or a search service.

**Evaluation.** Use a test repo and channel with one decision repeated in a PR and in Slack, one superseding decision, and an unrelated commit. Compare the evidence recovered, whether the origin is traceable, and how missing pages or inaccessible sources are reported.

[Connector source tree](https://github.com/onyx-dot-app/onyx/tree/main/backend/onyx/connectors) · [License](https://github.com/onyx-dot-app/onyx/blob/main/LICENSE)
