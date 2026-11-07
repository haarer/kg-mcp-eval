# Read-only v0 with capability-tagged architecture

v0 exposes no mutation tools. The eventual goal is an LLM acting on systems-engineering models, so tools carry `read`/`propose`/`write` capability tags and the ontology model leaves room for mutation-validation hooks. This keeps the first evaluation focused on navigation and query while avoiding a redesign when write operations are introduced.

## Consequences

- No write path, rollback, concurrency, or authorization work is in scope for v0.
- Any future `propose`/`apply` tools must pass the same capability and ontology checks before being exposed.
