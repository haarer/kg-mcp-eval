# Results

## Status: first pass complete, official 3-rep run pending

Model: `schleppx/qwen/qwen3.8-27b` — unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_M,
256k context, 8-bit KV cache, served by llama.cpp on a 24GB laptop GPU
(~79 tok/s generation, ~336 tok/s prompt). The earlier free-tier provider block
no longer applies; all benchmark runs use this local model.

## First pass (1 rep, 12-task subset, 3 arms) — directional only

Subset: all 6 SE-seed tasks + 6 Hetionet tasks (one per category). 36/36
attempts completed. This is **not** a verdict: one rep, n=1 per category.

| arm | accuracy | wrong | invalid_format | timeout | avg tokens (all attempts) |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 83% (10/12) | 0 | 0 | 2 | ~13.0k |
| B | 67% (8/12) | 2 | 0 | 0 | ~12.2k |
| C | 50% (6/12) | 0 | 4 | 0 | ~29.1k |

Directional observations:
- Arm A was the most accurate and the most consistent (no format misses or
  wrong answers; its 2 failures were 300s-class timeouts on `het-onehop-01` and
  `het-negative-01`).
- Arm C was the least accurate and the most expensive once failures are counted:
  its dump-based navigation rambled (one-hop dump reached 164k tokens) and
  produced no JSON on 4 of 6 Hetionet tasks. True per-task cost ~2.3x arms A/B.
- The aggregate/path/multihop focus categories were answerable on A and B once
  the answer-extraction bug was fixed (see ADR 0003 refinements).

## Unverified / no claim

No pre-registered verdict is claimed. The hypothesis in ADR 0003 will be
evaluated on the full 44-task, 3-rep run, using all-attempt cost and the 300s
timeout.

## Run procedure

```sh
npm run bench            # 44 tasks, 3 reps, all arms (official)
npm run bench -- --smoke # one task per dataset/category, 1 rep
```

Outputs land in `bench/results/<run-id>/` (`raw.jsonl`, `summary.json`,
`report.md`). The `report.md` includes a per-status failure table with runtime
and reason.
