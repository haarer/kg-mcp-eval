# KG-MCP Eval

A single-context experiment that measures whether an LLM can navigate and query a typed knowledge graph more efficiently through a small, ontology-aware MCP surface than through generic alternatives.

## Language

**Knowledge graph (KG)**:
A set of typed nodes and typed edges, validated against an ontology.
_Avoid_: Database, dataset (when the graph itself is meant)

**Ontology**:
The allowed node kinds, edge kinds, endpoint pairs, direction, and property constraints for a KG.
_Avoid_: Schema, metamodel (in this project)

**Node kind**:
A category of node in the ontology, optionally with a parent kind.
_Avoid_: Node type, class

**Edge kind**:
A category of edge in the ontology with allowed source/target kinds and a direction.
_Avoid_: Relation, relationship type

**Metagraph**:
Hetionet's own representation of its node kinds and edge kinds; the source of that dataset's ontology.
_Avoid_: Schema

**Surface**:
The set of MCP tools, their descriptions, and their result shapes that an agent can use against a KG.
_Avoid_: API, endpoint

**Arm**:
One experimental configuration of the surface. Arm A is the typed graph-native surface, arm B is a generic Cypher tool, and arm C is a bounded data dump.
_Avoid_: Variant, condition

**Compact result**:
A bounded tool response containing typed IDs, labels, and edge kinds, with properties opt-in and explicit pagination.
_Avoid_: Summary, abbreviated result

**Sealed agent**:
The opencode agent used for measurement: built-in tools disabled, only the arm's MCP tools enabled, empty workdir.
_Avoid_: Sandbox (too broad)

**Task**:
One benchmark question with a dataset, category, prompt, answer type, constraints, and gold.
_Avoid_: Query, question

**Gold**:
The independently computed correct answer or validity predicate for a task.
_Avoid_: Expected output

**Oracle**:
The reference implementation that computes golds without using any arm's tool handlers.
_Avoid_: Reference tool

**Run**:
One execution of one task by one arm with one repetition.
_Avoid_: Trial, sample

**Dataset adapter**:
Code that maps a source ontology and graph into the internal ontology and graph model.
_Avoid_: Loader, importer

**Capability tag**:
A label on a tool indicating whether it reads, proposes changes, or writes.
_Avoid_: Permission

**SAF/FFDS**:
The systems-engineering specification and model source that will replace the v0 SE seed once access is provided.
_Avoid_: Target model
