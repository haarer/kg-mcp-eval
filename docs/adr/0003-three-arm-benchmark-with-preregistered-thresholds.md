# Three-arm benchmark with pre-registered success thresholds

We compare graph-native typed tools (A), a generic query tool backed by Kuzu Cypher (B), and a bounded data dump (C) using the same model, tasks, and data. Arm A supports the hypothesis only if it is within 5 percentage points of the best baseline on accuracy **and** uses at least 25% fewer tokens and 30% fewer tool calls on multi-hop/path/aggregate tasks, with latency at most 1.2x the best baseline. Arm A deliberately exposes no generic query escape hatch so the contrast remains meaningful. Recording the thresholds before running prevents post-hoc rationalization.

## Considered Options

- **Report-only evaluation** — honest exploration, but no falsifiable verdict.
- **Accuracy-only gate** — does not test the efficiency claim.
- **Two-arm comparison** — smaller, but drops the "why not just paste the data" baseline that makes token savings meaningful.
