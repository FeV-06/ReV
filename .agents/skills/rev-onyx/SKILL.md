---
name: rev-onyx
description: Study Onyx connector and retrieval patterns when improving GitHub or Slack ingestion, evidence selection, or source traceability in ReV.
---

# Onyx research for ReV

Use the [research note](../../../docs/research/onyx.md) to find Onyx connector code.

- Compare connector behavior on pagination, partial failures, stable source identity, and provenance before proposing an ingestion change.
- Test retrieval with a small corpus containing relevant records and plausible distractions. Check which evidence survives selection and whether the draft cites it accurately.
- Preserve ReV's explicit source selection and recipient review. Treat any automated source permission mapping as a separate capability to verify.
