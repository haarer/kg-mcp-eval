# Kuzu embedded Cypher for the generic-query arm, with a DSL fallback

Arm B uses Kuzu, an in-process property-graph database, so the generic baseline is real Cypher over the same normalized data without a separate server. The node package installs and loads on this host. If a future host cannot load the native module, the arm falls back to a small documented pattern DSL; the oracle remains independent of both.

## Consequences

- Arm B must reject mutating Cypher and enforce row/byte limits at the tool boundary.
- Loading the same normalized data into two representations (in-memory and Kuzu) is an accepted v0 cost to keep both arms honest.
