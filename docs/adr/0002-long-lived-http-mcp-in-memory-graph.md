# Long-lived HTTP MCP server holding the graph in memory

The benchmark runs hundreds of isolated agent sessions. A per-session stdio MCP server would reload the full Hetionet graph (2.25M edges) for every task, inflating latency and risking timeouts. We expose MCP over streamable HTTP from one long-lived process that loads and indexes the graph once, while retaining a thin stdio entrypoint for portability. Storage is in-memory typed indexes; there is no database.

## Consequences

- Benchmark runs connect as remote MCP clients and therefore must be isolated by agent configuration and workdir, not by process boundaries.
- The server must be started once per benchmark arm and its startup cost measured separately from task latency.
- A future deployment can swap the in-memory store for a persistent backend without changing tool contracts.
