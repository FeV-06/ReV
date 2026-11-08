# Synthetic Laya classification pilot

## Scope and caveat

This is a **small, self-authored synthetic pilot**, not a representative independent benchmark, held-out user dataset, production quality measurement, or reason to train/deploy a model. The keyword baseline was authored alongside the examples and is likely favored by the data. Labels describe one primary category even when a message may have multiple meanings. No private project data was used.

## Actual run

- Dataset: `synthetic-pilot.json`, 32 examples across decision, open work, risk and other.
- Laya: `convaiinnovations/laya` English base, `laya` 0.4.29, CPU, PyTorch 2.13.0+cu130. No fine-tuning.
- Baseline: the transparent keyword rules in `evaluate.py`.
- Laya: 26/32 correct (0.8125); median inference 0.2888 s per example; cold load 4.918 s. Open-work recall 4/7; other recall 7/10.
- Keyword baseline: 31/32 correct (0.9688) on the same **self-authored, potentially overfit** examples. This result cannot establish real-world superiority.
- Laya mistakes: `s07`, `s08`, `s25`, `s29`, `s31`, `s32`; no input was reported truncated on this short set.
- Runtime warning: one shipped temperature entry was outside the runtime's allowed range and was clamped. Do **not** treat reported confidence as calibrated on ReV data.

## Next gate

Collect a larger, independently labeled, permission-safe held-out set, include multi-label and long-context cases, measure per-label precision/recall, calibration, latency and truncation, and compare against independently defined baselines. Do not fine-tune or adopt a classifier based on this pilot. Classification does not authorize source access or establish factual truth.

## Reproduce

Install a compatible Python environment with `laya` 0.4.29 and PyTorch, then run:

```sh
python evals/classification/evaluate.py --output /path/to/results.json --device cpu
```

The script downloads the checkpoint on first use. Use `--baseline-only` to run without Laya. This experiment is separate from the ReV application and is not a default runtime dependency.
