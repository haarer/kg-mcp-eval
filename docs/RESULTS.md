# Results

## Status: benchmark not yet run

The harness, task suite, scoring, and report generator are implemented and
locally verified, but the full three-arm run has not completed in this
environment. The pinned-model step is blocked by provider quota: every free
model attempted (`opencode/flint-40b-free`, `opencode/deepseek-v4.1-flash-free`,
`opencode/beam-free`, `opencode/glm-5.3-flash-free`, `opencode/big-pickle`)
returned `Free usage limit reached` before the agent could make a tool call.

The harness detects this condition from stderr and aborts immediately rather
than timing out per task. Partial artifacts are written to
`bench/results/<run-id>/`.

## Verified before the model block

- Hetionet normalized counts: 47,031 nodes / 2,250,197 edges / 11 node kinds /
  24 edge kinds.
- SE seed: 31 nodes / 39 edges, ontology-valid.
- 44 tasks generated deterministically; every gold re-validated against the
  independent oracle.
- `npm test`: 9/9 tests pass (ontology, graph traversal, arm A, arm B/Kuzu,
  arm C, scorer, task determinism, bounded pagination).
- HTTP MCP end-to-end smoke: arm A tools callable over Streamable HTTP.
- Kuzu arm B smoke: schema, parameterized Cypher, relationship traversal, and
  mutation rejection. Full Hetionet Kuzu build verified: 47,031 nodes, all 24
  relationship tables, 2,250,197 edges, ~4s uncached / cache hit via manifest.
- Harness smoke: starts long-lived per-arm servers, writes a sealed opencode
  config, runs a fresh session, parses JSON events, scores, and writes
  `raw.jsonl`, `summary.json`, and `report.md`. A simulated opencode event
  stream verified the success path, token/tool counting, and scoring; `--smoke`
  selects one task per dataset/category.

## Unverified claims

No accuracy, token, tool-call, or latency result is claimed here. The
pre-registered thresholds in ADR 0003 remain untested.

## Resume procedure

```sh
npm run calibrate          # choose and pin the model in bench/model.json
npm run bench -- --smoke   # one task per dataset/category, 1 rep
npm run bench              # 44 tasks, 3 reps, all arms
```

Then replace this file with the generated `bench/results/<run-id>/report.md`
and state supported / not supported / inconclusive against the pre-registered
thresholds.
