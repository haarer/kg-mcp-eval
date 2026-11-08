# Gold answers come from an independent oracle

Gold answers are produced by a standalone reference implementation over the normalized graph, not by the MCP tool handlers and not by arm B's query engine. A single-ID task is scored by exact string match, an ID-set task by set equality, and numeric and boolean tasks by exact equality; path tasks are scored by path **validity** (any path that starts/ends correctly, stays within hop and edge-kind constraints) rather than one canonical path. This avoids circularity and lets the task suite be regenerated when data changes.

## Consequences

- The oracle must be exercised by fixture tests against known answers before its output is trusted.
- A human audits a sample of generated tasks and golds.
- Scoring is exact: a single-element array is not accepted for a single ID, and a
  `Kind::`-prefixed ID is not stripped. These are recorded as `wrong_answer`
  format misses rather than silently normalized or re-scored (see the post-run
  finding in ADR 0003).
