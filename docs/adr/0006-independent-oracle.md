# Gold answers come from an independent oracle

Gold answers are produced by a standalone reference implementation over the normalized graph, not by the MCP tool handlers and not by arm B's query engine. ID tasks are scored by normalized exact match or set-F1, numeric and boolean tasks by exact equality, and path tasks by path **validity** (any path that starts/ends correctly, stays within hop and edge-kind constraints) rather than one canonical path. This avoids circularity and lets the task suite be regenerated when data changes.

## Consequences

- The oracle must be exercised by fixture tests against known answers before its output is trusted.
- A human audits a sample of generated tasks and golds.
