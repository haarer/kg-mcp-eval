# Compact, bounded tool results with ontology-generated descriptions

Arm A returns compact JSON containing typed IDs, labels, and edge kinds, with properties opt-in via `fields`; results default to 25 rows with cursor pagination, plus hard byte caps and traversal bounds. Tool schemas and descriptions are generated from the ontology so allowed kinds and directions are visible without dumping the schema into context. Efficiency is partly a result-shaping property, so verbose defaults would bias the experiment against the surface under test. Arm C provides the explicit verbose/raw contrast.

## Consequences

- Every tool must specify deterministic truncation and a `nextCursor`; silent truncation is not allowed.
- Tool description text is part of the treatment and must be held constant across repetitions.
