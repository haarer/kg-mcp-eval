# Results

## Status: full run complete — pre-registered hypothesis **NOT SUPPORTED** (on token efficiency)

Model: `schleppx/qwen/qwen3.8-27b` — unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_M,
served by llama.cpp on a 24 GB GPU. The definitive run used **192 K context
(`n_ctx=196608`), q8_0 KV cache, single slot (`--parallel 1`), MTP speculative
decode**, power-capped at the system's 150 W thermal-design limit (~52 tok/s
decode, ~1.1–1.3 k tok/s prefill; `SW_POWER_CAP`).

Run: `bench/results/full-44-v2` — **44 tasks × 3 arms × 3 reps = 396 attempts**,
300 s timeout, all-attempt cost, **0 server stalls** (the earlier 256 K stall
confound did not recur at 192 K). Wall-clock 8 h 40 m.

The three arms share one question per task and differ only in surface:
- **A** — typed, ontology-aware tools (`schema`, `search`, `node`, `neighbors`, `path`, `aggregate`)
- **B** — `schema` + read-only Cypher (`cypher`)
- **C** — `schema` + bounded graph dump (`dump`)

### Overall (132 attempts per arm)

| arm | accuracy | 95% CI | tokens (mean/attempt) | tool calls | turns | latency |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| **A** | **94.7%** | 90.2–98.5% | 17,594 | 4.1 | 4.3 | 20.5 s |
| B | 88.6% | 82.6–93.9% | 18,861 | 5.6 | 5.3 | 22.0 s |
| C | 37.9% | 29.5–46.2% | 109,473 | 6.8 | 5.5 | 168.4 s |

Status breakdown (n=132 each): **A** 125 correct · 7 wrong; **B** 117 correct ·
13 wrong · 1 invalid_format · 1 tool_limit; **C** 50 correct · 6 wrong ·
34 invalid_format · 42 timeout.

### Pre-registered verdict (focus: multi-hop / path / aggregate; n=54 per arm)

**NOT SUPPORTED.** Arm A vs the best baseline (B):

| criterion | A | B | threshold | result |
| --- | ---: | ---: | --- | --- |
| accuracy | 98.1% | 96.3% | within 5 pp | **pass** |
| tokens | 25,363 | 29,194 | ≥25% fewer | **FAIL** (only 13% fewer) |
| tool calls | 4.9 | 8.3 | ≥30% fewer | **pass** (41% fewer) |
| latency | 27.6 s | 33.1 s | ≤1.2× baseline | **pass** |

The typed surface matches/beats accuracy, and cuts tool calls and latency — but
**it does not clear the token-efficiency bar** on the complex categories. The
13% token reduction is far short of 25%, and that single failure decides the
verdict.

## Where A wins, where B wins, and why

Focus-category detail (Δ = A relative to B; negative token Δ = A cheaper):

| category | A acc | B acc | A tokens | B tokens | token Δ | A tools | B tools | A lat | B lat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi_hop | 100.0% | 88.9% | 30,895 | 49,016 | **−37%** | 5.0 | 14.2 | 30 s | 54 s |
| path | 94.4% | 100.0% | 29,119 | 23,533 | **+24%** | 5.6 | 6.4 | 34 s | 31 s |
| aggregate | 100.0% | 100.0% | 16,074 | 15,034 | +7% | 4.1 | 4.4 | 19 s | 14 s |
| **combined** | **98.1%** | **96.3%** | **25,363** | **29,194** | **−13%** | **4.9** | **8.3** | **27.6 s** | **33.1 s** |

### Why A wins — decisively — on multi-hop
`kg_path` answers a bounded hop query in essentially one call, whereas B must
*discover* the traversal through iterative Cypher. B needed **14.2 tool calls /
9.1 turns** vs A's **5.0 / 4.9**, and that iteration inflates cumulative
`cacheRead` (41,532 vs 24,096 tokens) — the single largest driver of total cost.
Net: **−37% tokens, −65% tool calls, 44% faster** on multi-hop, at equal-or-better
accuracy (A 100%, B 88.9%). This is the clearest demonstration of the typed
surface's value: it encodes the traversal so the model doesn't have to.

### Why B wins/ties — slightly — on path and aggregate
Here a single well-formed Cypher projection (`MATCH … RETURN …`) returns exactly
the columns the answer needs, while A's typed results are *bulkier*: they carry
labels, edge kinds, and pagination structure, so A's per-attempt input is larger
(path: A 5,585 input tokens vs B 3,365) and its cumulative context grows faster.
Result: B is **24% cheaper on path** and **7% cheaper on aggregate**, and slightly
faster on both. Accuracy is effectively tied (aggregate 100% = 100%; path B 100%
vs A 94.4%, A's one miss being a representation slip — see failure anatomy).
In short, **A's structured output is a liability when the answer is a single
compact projection**.

### Why A wins on lookup and SE composition — but read the caveat
A's headline gaps here (lookup 79.2% vs 62.5%; SE composition 83.3% vs 33.3%) are
**almost entirely answer-formatting, not navigation**:
- Lookup (`id` type): every miss for A and B is the model returning `["Gene::X"]`
  instead of `"Gene::X"` — the value is correct, only the wrapping is wrong.
  A did this 5×, B 9×. After normalizing the array wrap, **both A and B are
  100% on lookups** (C remains broken — its lookup misses are invalid/timeout).
- SE composition (`id_set`): B and C returned **kind-prefixed** IDs
  (`SoftwareComponent::C-ACT`) where gold is bare (`C-ACT`); A mostly returned
  bare IDs. After stripping the `Kind::` prefix, **all three arms are 100%** on
  SE composition.

So the apparent accuracy advantage is really "A's typed surface tends to emit
IDs in the answer-ready convention." That is a real usability benefit, but it is
a formatting effect, not a difference in graph-navigation capability.

### Where they tie
`one_hop` (100% / 100%), `negative` (100% / 100%), `se_hierarchy` (100% / 100%),
`se_trace` (100% / 100%). These are small, local, format-simple questions that
all surfaces handle; the differentiator is efficiency, not correctness.

## Why both A and B beat C

Arm C is not a viable surface for navigation and is dominated on every
non-trivial category:

| category | C acc | C tokens | C latency | C invalid/timeout |
| --- | ---: | ---: | ---: | --- |
| lookup | 4.2% | 265,842 | 241 s | 21 of 24 |
| one_hop | 62.5% | 108,929 | 137 s | 9 of 24 |
| multi_hop | 0.0% | 53,466 | 269 s | 18 of 18 |
| aggregate | 27.8% | 188,177 | 222 s | 13 of 18 |
| path | 16.7% | 46,159 | 220 s | 15 of 18 |
| negative | 100% | 8,371 | 11 s | 0 |
| se_hierarchy | 100% | 7,709 | 11 s | 0 |
| se_trace | 100% | 9,631 | 12 s | 0 |

**Mechanism.** C answers by pulling large bounded slices of the graph into the
context window. That is catastrophic in three compounding ways:
1. **Token explosion** — a lookup costs C ~266 k tokens vs ~9 k for A/B, because
   it must read pages of nodes/edges to find one ID. Outliers reached 719 k and
   997 k tokens in a single attempt. This is ~30× the typed surface.
2. **Non-convergence** — with the answer buried in a huge dump, the model often
   fails to emit a parseable `{"answer": …}` at all: **34 invalid_format**.
3. **Timeout** — at ~52 tok/s decode with multi-hundred-k-token contexts, many
   attempts exceed the 300 s budget before finishing: **42 timeouts**.

C is competitive **only** where the answer is tiny and local and the format is
simple — negative (100%), SE hierarchy (100%), SE trace (100%), one-hop (62.5%).
The moment a task requires navigation, aggregation, or path-finding, the dump
surface collapses. This is the strongest, cleanest result in the run: **a
generic "just give me the data" surface is not a substitute for a query surface
on a 2.25 M-edge graph.**

## Failure anatomy: formatting artifacts vs real errors

| status | A | B | C | total |
| --- | ---: | ---: | ---: | ---: |
| wrong_answer | 7 | 13 | 6 | 26 |
| invalid_format | 0 | 1 | 34 | 35 |
| timeout | 0 | 0 | 42 | 42 |
| tool_limit | 0 | 1 | 0 | 1 |

The 26 `wrong_answer`s decompose as:
- **16 id-array wraps** (A 5, B 9, C 2) — verified **16/16 carry the exact gold
  value**, just `["x"]` instead of `"x"`.
- **9 prefixed-ID sets** (A 1, B 4, C 4) — verified **9/9 match gold after
  stripping the `Kind::` prefix**.
- **1 edge-label path** (A, `het-path-03`) — correct nodes, but the edges were
  reported as human labels (`"Anatomy - downregulates - Gene"`) instead of
  edge-kind IDs, so the path failed validation.

**Implication:** measured *accuracy* here is dominated by answer-contract
adherence, not by graph-navigation capability. Normalizing these artifacts would
give overall accuracy **A 99.2% (131/132), B 98.5% (130/132), C 42.4% (56/132)**;
all 25 array/prefix artifacts are in `lookup` and `se_composition`, so the
focus-category accuracy is unaffected. A fairer accuracy read would normalize the
`id` array-wrap and the `Kind::` ID prefix in scoring (or tighten the answer
contract in the prompt). This would not change the pre-registered
verdict — that fails on tokens — but it means the accuracy numbers should be
read as "convention compliance" as much as correctness. It also means B's
multi-hop accuracy loss (2/18) is budget-related (one invalid_format, one
tool_limit), not wrong answers.

## Caveats / limitations

- **Sampling-parameter discrepancy (unverified).** The harness config sets
  `agent["kg-sealed"].temperature = 0`, but the server's `/slots` reported
  `temperature: 1, top_k: 20, top_p: 0.95` during the run. If opencode is not
  forwarding `temperature: 0` to the OpenAI-compatible endpoint, reps carry
  sampling variance. This should be verified (one-token probe against `/slots`)
  before treating rep-level numbers as reproducible; it may explain some
  rep-to-rep flips.
- **`tokens` includes `cacheRead`.** `tokens.total = input + output + reasoning
  + cacheRead + cacheWrite`, and `cacheRead` dominates (e.g. A multi-hop: 24,096
  of 30,895). Token cost is therefore essentially cumulative context
  re-processing across turns, which rewards fewer turns and smaller tool
  payloads — exactly the axis on which A (multi-hop) and B (path/aggregate)
  trade places.
- **Small per-category n** for the SE seed (3–6 attempts per arm per category);
  treat those percentages as directional.
- **Latency is power-capped.** The GPU runs at its 150 W design limit
  (`SW_POWER_CAP`), so decode is ~52 tok/s. Latency differences are driven
  mostly by output volume; C's high latency is a direct consequence of its
  token volume.
- **Stability.** 0 `server_stall` retries across 396 attempts at 192 K, so the
  earlier infra-stall confound did not affect this run (see ADR 0003).

## Earlier runs (superseded, kept for provenance)

- `bench/results/pass-3rep` — 12-task subset × 3 reps = 108 attempts. A 80.6% /
  B 83.3% / C 58.3%; focus hypothesis NOT SUPPORTED (arm A's two focus losses
  were then-misclassified 0-token server stalls). Superseded by the full run.
- `bench/results/first-pass` — 1 rep × 12-task subset, directional only
  (A 83%, B 67%, C 50%). Not a verdict.

## Run procedure

```sh
npm run bench            # 44 tasks, 3 reps, all arms (official)
npm run bench -- --smoke # one task per dataset/category, 1 rep
```

Outputs land in `bench/results/<run-id>/` (`raw.jsonl`, `summary.json`,
`report.md`, and a live `progress.log`). `report.md` includes a per-status
failure table with runtime and reason. Server flags for the definitive run are
recorded in ADR 0003.
