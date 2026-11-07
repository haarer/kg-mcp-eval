# KG-MCP Eval

Evaluate whether a small, ontology-aware MCP surface lets an LLM navigate and query a knowledge graph more efficiently than generic alternatives.

## Hypothesis

A typed, graph-native surface (arm A) answers KG questions at least as accurately as a generic Cypher tool (arm B) or a bounded data dump (arm C), while using >=25% fewer tokens and >=30% fewer tool calls on multi-hop, path, and aggregate tasks.

This is a deliberately falsifiable experiment. The pre-registered thresholds live in `docs/adr/0003-three-arm-benchmark-with-preregistered-thresholds.md`.

## Architecture

```
opencode (sealed agent)
        │  MCP over streamable HTTP
        ▼
  arm A/B/C server ──► in-memory typed graph
        │                 ▲
        │                 │
        └──► Kuzu (B)     └── normalized ontology + graph
```

- `src/ontology` — normalized JSON ontology, validation, source adapters.
- `src/graph` — in-memory store, indexes, loader.
- `src/server` — MCP HTTP/stdio entrypoints and the three arm surfaces.
- `src/oracle` — independent reference answers for golds.
- `bench` — task suite, sealed opencode harness, scoring, report.
- `docs/adr` — recorded architecture decisions.

## Data

- [Hetionet v1.0](https://github.com/hetio/hetionet) — 47,031 nodes / 2,250,197 edges / 11 node kinds / 24 edge kinds (CC BY 4.0, attribution in `data/NOTICE.md`).
- A small hand-authored systems-engineering seed exercising subtype hierarchy, composition, and trace links.
- A SAF/FFDS adapter boundary exists so a real specification model can replace the seed later.

## Quick start

```sh
npm install
npm run data            # download and normalize Hetionet + write SE seed
npm test                # unit + integration tests
npm run tasks           # regenerate the benchmark suite and golds
npm run dev             # start the arm-A MCP server (HTTP)
npm run calibrate       # choose and pin the benchmark model
npm run bench -- --smoke
npm run bench           # full 44-task, 3-rep run
```

See `docs/PLAN.md` for the protocol and `docs/RESULTS.md` for current status.

## Status

See `docs/PLAN.md` for milestones and `docs/RESULTS.md` once the benchmark has run. Architecture decisions are in `docs/adr/`; project vocabulary is in `CONTEXT.md`.
