export type PropertyType = "string" | "number" | "boolean";

export interface PropertySpec {
  name: string;
  type: PropertyType;
  required?: boolean;
  description?: string;
}

export interface NodeKind {
  id: string;
  label: string;
  parent?: string;
  abbreviation?: string;
  description?: string;
  properties?: PropertySpec[];
}

export interface EdgeEndpoint {
  source: string;
  target: string;
}

export interface EdgeKind {
  id: string;
  label: string;
  endpoints: EdgeEndpoint[];
  direction: "forward" | "both";
  description?: string;
  properties?: PropertySpec[];
}

export interface OntologyCounts {
  nodes?: number;
  edges?: number;
  nodeKinds?: Record<string, number>;
  edgeKinds?: Record<string, number>;
}

export interface Ontology {
  name: string;
  version: string;
  source?: string;
  nodeKinds: NodeKind[];
  edgeKinds: EdgeKind[];
  counts?: OntologyCounts;
}

export interface OntologyIndex {
  ontology: Ontology;
  nodeKindById: Map<string, NodeKind>;
  edgeKindById: Map<string, EdgeKind>;
}

export function indexOntology(ontology: Ontology): OntologyIndex {
  return {
    ontology,
    nodeKindById: new Map(ontology.nodeKinds.map((k) => [k.id, k])),
    edgeKindById: new Map(ontology.edgeKinds.map((k) => [k.id, k])),
  };
}

export function isSubtypeOf(
  index: OntologyIndex,
  kindId: string,
  ancestorId: string,
): boolean {
  let current: string | undefined = kindId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = index.nodeKindById.get(current)?.parent;
  }
  return false;
}

export function edgeAllowsPair(
  edge: EdgeKind,
  sourceKind: string,
  targetKind: string,
): boolean {
  return edge.endpoints.some(
    (e) => e.source === sourceKind && e.target === targetKind,
  );
}
