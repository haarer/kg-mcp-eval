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
  `correct | wrong_answer | invalid_format | timeout | server_stall |
  tool_limit | turn_limit | error`, with a reason and runtime, so a wrong
  result, a format miss, a budget overrun, and an infrastructure stall are
  reported as distinct findings.
- **Infrastructure server stalls are classified and re-tried, not scored.** A
  timeout in which the model completed *no* step at all (0 tokens, 0 turns) is
  an intermittent stall in the remote llama.cpp server (the GPU box occasionally
  takes far longer than the budget to emit its first step), not a model
  capability failure — the model never got to attempt the question. It is tagged
  `server_stall` and automatically re-tried up to `KG_STALL_RETRIES` (default 1)
  times so each (task, rep, arm) cell records a real model attempt; a cell still
  stalled after the retry budget is kept and reported as infrastructure, excluded
  from model scoring. This was diagnosed by probing the endpoint directly
  (opencode bypassed): ~5–7% of requests show a 15–23s prefill stall, and the
  300s 0-token timeouts are the severe tail of the same distribution. It is a
  measurement-validity correction, not a change to the measured surfaces.
- **Answer extraction is root-level.** The scorer takes the last *root-level*
  JSON in the model's final message. An earlier bug returned a nested sub-array
  (e.g. the `edges` list inside a path answer) instead of the answer object; the
  model was in fact emitting correct JSON and was being mis-scored.
- **Self-validation tool.** All arms expose `validate_answer`, which checks that
  a candidate final message is well-formed (format only, not correctness). The
  sealed prompt instructs the agent to call it before finishing. This is a
  model-agnostic robustness aid, available equally to every arm.
- **opencode-exit hang handling.** `opencode run` does not reliably exit after a
  session that used MCP tools: the process hangs (no open handles) once the
  model emits its final step. The harness detects that final step
  (`step_finish` with `reason=stop`), waits an 8s grace period, then terminates
  the process, and measures latency to the final step (not the reaping). This
  converts what were previously recorded as 300s "timeouts" — where the model
  had already answered — into correct completions. A *genuine* model
  over-reasoning (no final step within the 300s budget) still counts as a
  timeout and is reported under its own status.

Model pinned for the official run: `schleppx/qwen/qwen3.8-27b`
(unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_M, 256k context, 8-bit KV cache), served by
llama.cpp on a 24GB laptop GPU.
