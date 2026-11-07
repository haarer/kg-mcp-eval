# Three-arm benchmark with pre-registered success thresholds

We compare graph-native typed tools (A), a generic query tool backed by Kuzu Cypher (B), and a bounded data dump (C) using the same model, tasks, and data. Arm A supports the hypothesis only if it is within 5 percentage points of the best baseline on accuracy **and** uses at least 25% fewer tokens and 30% fewer tool calls on multi-hop/path/aggregate tasks, with latency at most 1.2x the best baseline. Arm A deliberately exposes no generic query escape hatch so the contrast remains meaningful. Recording the thresholds before running prevents post-hoc rationalization.

## Considered Options

- **Report-only evaluation** — honest exploration, but no falsifiable verdict.
- **Accuracy-only gate** — does not test the efficiency claim.
- **Two-arm comparison** — smaller, but drops the "why not just paste the data" baseline that makes token savings meaningful.

## Protocol refinements (fixed before the official run)

Decided and frozen before the 3-rep run, so they do not count as post-hoc tuning:

- **Cost is measured over all attempts.** Per-task tokens, tool calls, turns, and
  latency are averaged over *every* attempt, including failures and timeouts. A
  task that rambles and fails, or times out, still spent that budget; excluding
  it would understate an arm's true cost (e.g. a dump-based arm that scans a
  160k-token page and produces no answer). Accuracy is likewise over all
  attempts. A separate `invalid`/`status` count records how often an arm failed
  to emit a usable answer.
- **Per-attempt timeout is 300s** (raised from 120s). The pinned model is a
  reasoning model on a laptop GPU; 120s cut off valid-but-slow reasoning. A
  timeout is recorded as its own failure class, not folded into "wrong answer".
- **Per-attempt failure classification.** Every attempt is tagged
  `correct | wrong_answer | invalid_format | timeout | tool_limit | turn_limit |
  error`, with a reason and runtime, so a wrong result, a format miss, and a
  budget overrun are reported as distinct findings.
- **Answer extraction is root-level.** The scorer takes the last *root-level*
  JSON in the model's final message. An earlier bug returned a nested sub-array
  (e.g. the `edges` list inside a path answer) instead of the answer object; the
  model was in fact emitting correct JSON and was being mis-scored.
- **Self-validation tool.** All arms expose `validate_answer`, which checks that
  a candidate final message is well-formed (format only, not correctness). The
  sealed prompt instructs the agent to call it before finishing. This is a
  model-agnostic robustness aid, available equally to every arm.

Model pinned for the official run: `schleppx/qwen/qwen3.8-27b`
(unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_M, 256k context, 8-bit KV cache), served by
llama.cpp on a 24GB laptop GPU.
