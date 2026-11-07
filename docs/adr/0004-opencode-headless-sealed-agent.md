# Drive the eval through opencode headless with a sealed agent

The harness invokes `opencode run --format json` once per task with a dedicated agent whose built-in tools are disabled and whose only enabled tools are the arm's MCP tools. Each run uses an empty temporary workdir; the dataset, oracle, golds, and harness are not reachable from it. This exercises the real agent harness the idea targets and yields tool-call and token traces, while preventing the agent from reading the dataset directly and invalidating the comparison. One model is pinned and frozen after a small calibration run.

## Consequences

- Token and tool-call accounting depends on opencode's JSON events and session export; the harness must record raw traces.
- The eval is coupled to opencode's config/agent semantics; a later port to another client needs a new adapter, not a new benchmark.
