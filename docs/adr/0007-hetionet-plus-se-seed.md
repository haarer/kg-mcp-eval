# Evaluate on Hetionet plus a small systems-engineering seed, with a deferred SAF adapter

v0 uses Hetionet because it is a real, downloadable knowledge graph with a documented 11-node/24-edge metagraph at meaningful scale. Hetionet is flat, so we add a hand-authored 30-60 node systems-engineering seed that exercises subtype hierarchy, composition, and trace links, which the eventual target domain needs. Ingestion is behind source adapters so a real SAF/FFDS extractor can replace the seed later; v0 does not block on SAF access.

## Considered Options

- **Hetionet only** — smaller, but under-tests the ontology-guided half of the hypothesis.
- **Small formal ontology only** — richer semantics but toy scale, so token-efficiency results are unconvincing.
- **Two real graphs** — more generality, but doubles ingestion work before the core question is answered.
