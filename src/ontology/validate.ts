import type { GraphEdgeInput, GraphNodeInput } from "../graph/types.js";
import type { Ontology, OntologyIndex } from "./types.js";
import { edgeAllowsPair, indexOntology, isSubtypeOf } from "./types.js";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  nodeCount: number;
  edgeCount: number;
  edgeCountsByKind: Record<string, number>;
}

export function validateOntology(ontology: Ontology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  for (const kind of ontology.nodeKinds) {
    if (nodeIds.has(kind.id)) {
      issues.push({
        level: "error",
        code: "duplicate-node-kind",
        message: `Duplicate node kind: ${kind.id}`,
      });
    }
    nodeIds.add(kind.id);
  }
  for (const kind of ontology.nodeKinds) {
    if (kind.parent && !nodeIds.has(kind.parent)) {
      issues.push({
        level: "error",
        code: "unknown-parent",
        message: `Node kind ${kind.id} has unknown parent ${kind.parent}`,
      });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(ontology.nodeKinds.map((k) => [k.id, k]));
  const checkCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const parent = byId.get(id)?.parent;
    const cyclic = parent ? checkCycle(parent) : false;
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  for (const kind of ontology.nodeKinds) {
    if (checkCycle(kind.id)) {
      issues.push({
        level: "error",
        code: "kind-cycle",
        message: `Node kind hierarchy contains a cycle at ${kind.id}`,
      });
      break;
    }
  }

  const edgeIds = new Set<string>();
  for (const kind of ontology.edgeKinds) {
    if (edgeIds.has(kind.id)) {
      issues.push({
        level: "error",
        code: "duplicate-edge-kind",
        message: `Duplicate edge kind: ${kind.id}`,
      });
    }
    edgeIds.add(kind.id);
    if (kind.endpoints.length === 0) {
      issues.push({
        level: "error",
        code: "no-endpoints",
        message: `Edge kind ${kind.id} has no endpoints`,
      });
    }
    for (const endpoint of kind.endpoints) {
      if (!nodeIds.has(endpoint.source)) {
        issues.push({
          level: "error",
          code: "unknown-source-kind",
          message: `Edge kind ${kind.id} references unknown source kind ${endpoint.source}`,
        });
      }
      if (!nodeIds.has(endpoint.target)) {
        issues.push({
          level: "error",
          code: "unknown-target-kind",
          message: `Edge kind ${kind.id} references unknown target kind ${endpoint.target}`,
        });
      }
    }
  }
  return issues;
}

export function validateGraph(
  ontology: Ontology,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  maxIssues = 50,
): ValidationReport {
  const index = indexOntology(ontology);
  const issues: ValidationIssue[] = [...validateOntology(ontology)];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeCountsByKind: Record<string, number> = {};

  for (const node of nodes) {
    if (!index.nodeKindById.has(node.kind)) {
      issues.push({
        level: "error",
        code: "unknown-node-kind",
        message: `Node ${node.id} has unknown kind ${node.kind}`,
      });
      if (issues.length >= maxIssues) break;
    }
  }

  const allowedPairs = new Map<string, Set<string>>();
  for (const kind of ontology.edgeKinds) {
    allowedPairs.set(
      kind.id,
      new Set(kind.endpoints.map((e) => `${e.source}\u0000${e.target}`)),
    );
  }

  for (const edge of edges) {
    const sourceIndex = nodeIds.has(edge.source);
    const targetIndex = nodeIds.has(edge.target);
    if (!sourceIndex || !targetIndex) {
      issues.push({
        level: "error",
        code: "unknown-endpoint",
        message: `Edge ${edge.source} -[${edge.kind}]-> ${edge.target} references a missing node`,
      });
      if (issues.length >= maxIssues) break;
      continue;
    }
    const edgeKind = index.edgeKindById.get(edge.kind);
    if (!edgeKind) {
      issues.push({
        level: "error",
        code: "unknown-edge-kind",
        message: `Unknown edge kind: ${edge.kind}`,
      });
      if (issues.length >= maxIssues) break;
      continue;
    }
    edgeCountsByKind[edge.kind] = (edgeCountsByKind[edge.kind] ?? 0) + 1;
    const sourceKind = findNodeKind(nodes, edge.source);
    const targetKind = findNodeKind(nodes, edge.target);
    if (!sourceKind || !targetKind) continue;
    if (!pairAllowed(index, edgeKind.id, sourceKind, targetKind, allowedPairs)) {
      issues.push({
        level: "error",
        code: "endpoint-kind-violation",
        message: `Edge kind ${edge.kind} does not allow ${sourceKind} -> ${targetKind}`,
      });
      if (issues.length >= maxIssues) break;
    }
  }

  return {
    issues,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    edgeCountsByKind,
  };
}

const nodeKindCache = new WeakMap<GraphNodeInput[], Map<string, string>>();

function findNodeKind(
  nodes: GraphNodeInput[],
  id: string,
): string | undefined {
  let cache = nodeKindCache.get(nodes);
  if (!cache) {
    cache = new Map(nodes.map((n) => [n.id, n.kind]));
    nodeKindCache.set(nodes, cache);
  }
  return cache.get(id);
}

function pairAllowed(
  index: OntologyIndex,
  edgeKindId: string,
  sourceKind: string,
  targetKind: string,
  allowedPairs: Map<string, Set<string>>,
): boolean {
  const direct = allowedPairs.get(edgeKindId);
  if (direct?.has(`${sourceKind}\u0000${targetKind}`)) return true;
  const edgeKind = index.edgeKindById.get(edgeKindId);
  if (!edgeKind) return false;
  return edgeKind.endpoints.some(
    (endpoint) =>
      isSubtypeOf(index, sourceKind, endpoint.source) &&
      isSubtypeOf(index, targetKind, endpoint.target),
  );
}

export function assertValidOntology(ontology: Ontology): void {
  const issues = validateOntology(ontology);
  if (issues.length > 0) {
    throw new Error(
      `Invalid ontology:\n${issues.map((i) => `- ${i.message}`).join("\n")}`,
    );
  }
}
