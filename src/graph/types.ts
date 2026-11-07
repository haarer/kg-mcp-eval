export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface GraphNodeInput {
  id: string;
  kind: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdgeInput {
  source: string;
  target: string;
  kind: string;
  properties?: Record<string, unknown>;
}

export type TraceDirection = "out" | "in" | "both";

export interface NeighborHit {
  edgeIndex: number;
  edgeKind: string;
  direction: "out" | "in";
  nodeIndex: number;
}

export interface PathResult {
  nodes: string[];
  edges: string[];
}
