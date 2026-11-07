# Results

## Status: 3-rep subset run complete

Model: `schleppx/qwen/qwen3.8-27b` — unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_M,
256k context, 8-bit KV cache, served by llama.cpp on a 24GB laptop GPU
(~79 tok/s generation, ~336 tok/s prompt). All benchmark runs use this local
model.

Run: `bench/results/pass-3rep` — 12-task subset (6 SE-seed + 6 Hetionet), 3
arms, 3 reps = 108 attempts, 300s timeout, all-attempt cost.

### Overall (36 attempts per arm)

| arm | accuracy | tokens (all attempts) | tool calls | latency ms | status breakdown |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 80.6% | 13,345 | 3.8 | 69,505 | 29 correct · 5 timeout · 2 wrong |
| B | 83.3% | 14,692 | 4.8 | 44,635 | 30 correct · 1 timeout · 5 wrong |
| C | 58.3% | 39,767 | 4.6 | 98,721 | 21 correct · 7 timeout · 3 invalid_format · 5 wrong |

### Pre-registered hypothesis (focus: multi-hop / path / aggregate)

**NOT SUPPORTED**, and the failure is driven by timeouts, not the surface:
- accuracy A 77.8% vs B 100% — **fail**; A lost 2 of 9 focus attempts to
  timeouts (`het-aggregate-01` rep 2, `het-multihop-01` rep 3). With those two
  timeouts removed A would be 9/9 (100%), matching B.
- tokens A 16,264 vs B 25,804 — **pass** (37% fewer).
- tool calls A 3.9 vs B 7.2 — **pass** (46% fewer).
- latency A 112,007ms vs B 56,845ms — **fail** (A's 300s timeouts inflate it).

### Central confound: timeouts split two ways

- **Arm C timeouts (7) + invalid_format (3)** are surface-related: the dump
  surface does not converge on Hetionet navigation (it scans 111k–371k-token
  pages and never emits an answer). Genuine finding about arm C.
- **Arm A timeouts (5) were 0-token/0-turn — now diagnosed as infrastructure
  server stalls, not model or surface faults.** The remote llama.cpp box
  intermittently stalls before completing even one step (a direct endpoint probe
  with opencode bypassed showed ~5–7% of requests with a 15–23s prefill stall;
  the 300s 0-token timeouts are the severe tail of the same stall). The typed
  tools are fast and the model produces a normal answer when the server is not
  stalled (the same `het-lookup-03` task that 0-token-timed-out completed
  correctly in ~28s on a clean re-run). The harness now classifies these as
  `server_stall` and re-tries them (see ADR 0003), so they no longer contaminate
  arm A's measured accuracy or latency. This was the confound that flipped the
  accuracy and latency checks against arm A.

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
