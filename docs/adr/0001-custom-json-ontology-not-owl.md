# Use a normalized JSON ontology model instead of OWL/RDF

We need node/edge kinds, allowed endpoints, direction, cardinality hints, and property schemas to drive ingest validation, tool descriptions, and query bounds. We chose a small internal JSON model with per-source adapters over an OWL/RDFS/SHACL stack because the experiment evaluates the MCP surface, not formal reasoning, and the host has no Python/RDF toolchain. A SAF/OWL adapter can translate into this model later without changing the tools.

## Considered Options

- **OWL/RDFS parser + reasoner** — most faithful to a future SAF ontology, but heavy, ambiguous about inferred vs asserted facts, and adds an RDF stack we do not otherwise need.
- **SHACL shapes** — strong validation, but another specification/toolchain and still needs a graph store.
- **Per-dataset hardcoded schema** — fastest for Hetionet, but cannot honestly test ontology-guided behavior or accept SAF later.
