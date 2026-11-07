# Plan

## Hypothesis

A small, typed, ontology-aware MCP surface lets an LLM answer knowledge-graph questions at least as accurately as general-purpose baselines while using **>=25% fewer tokens** and **>=30% fewer tool calls** on multi-hop, path, and aggregate tasks (latency <=1.2x best baseline, accuracy within 5pp).

## Arms

| Arm | Surface | Purpose |
| --- | --- | --- |
| A | `schema`, `search`, `node`, `neighbors`, `path`, `aggregate` | The idea under test |
| B | `schema` + read-only `cypher` over Kuzu | Realistic generic-query baseline |
| C | `schema` + bounded `dump` | "Just paste the data" baseline |

See `docs/adr/` for the decisions behind these choices.

## Data

- **Hetionet v1.0** — 47,031 nodes, 2,250,197 edges, 11 node kinds, 24 edge kinds.
- **SE seed** — 30-60 hand-authored nodes covering subtype hierarchy, composition, and trace links.
- A SAF/FFDS adapter is an interface only in v0.

## Task suite (44 tasks)

Hetionet (38): 8 lookup, 8 one-hop, 6 multi-hop, 6 aggregate, 6 path/trace, 4 negative/ontology-boundary.
SE seed (6): subtype hierarchy, composition, and trace-link tasks.

Each task records `id`, `dataset`, `category`, `prompt`, `answer_type`, `constraints`, and `gold`.

## Protocol

- 3 repetitions, fresh opencode session per run, low temperature.
- <=25 tool calls, <=15 turns, 120s timeout per run.
- Arms interleaved per task/repetition.
- Sealed agent; no dataset or golds reachable from the workdir.
- Per-category median + IQR and bootstrap 95% CIs.

## Running

```sh
npm run data
npm run tasks
npm run calibrate          # writes bench/model.json
npm run bench -- --smoke   # one task per dataset/category, 1 rep, all arms
npm run bench              # 44 tasks, 3 reps, all arms
```

Environment overrides: `KG_MODEL`, `KG_ARMS`, `KG_REPS`, `KG_TASKS`,
`KG_TASK_LIMIT`, `KG_TIMEOUT_MS`, `KG_MAX_TOOL_CALLS`, `KG_MAX_TURNS`,
`KG_PORT_BASE`, `KG_OUT`.

The harness starts one long-lived HTTP MCP server per arm/dataset, writes a
sealed opencode config with global MCP servers disabled, and runs a fresh
`opencode run --format json` session per task. It aborts on provider quota or
access errors instead of burning the full timeout.

## Milestones

0. Scaffold, download Hetionet, verify counts and attribution.
1. Ontology model, adapters, validation, graph store/indexes.
2. Independent oracle and task generation.
3. Arm A MCP tools (HTTP + stdio) and tests.
4. Arms B and C.
5. Sealed opencode agents and benchmark harness.
6. Smoke run, model calibration, frozen run manifest.
7. Full run, scoring, `docs/RESULTS.md`.

## Exit criteria

- `npm test` green.
- `npm run bench -- --smoke` completes.
- Full run artifacts exist and `docs/RESULTS.md` states supported / not supported / inconclusive against the pre-registered thresholds.
- `npm run data && npm run bench` reproduces the evaluation.

## Risks

| Risk | Mitigation |
| --- | --- |
| Kuzu native module unavailable | Fallback pattern DSL in arm B |
| opencode token trace insufficient | Parse JSON events; fall back to session export/provider usage |
| Model drift | Pin model and settings; interleave; store manifest |
| Agent reads data directly | Sealed agent and empty workdir |
| Graph reload skews latency | Long-lived HTTP server |
| SAF access absent | Adapter boundary only |
