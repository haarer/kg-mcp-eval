import type { LoadedDataset } from "../graph/load.js";
import type { TraceDirection } from "../graph/types.js";
import { edgeAllowsPair, isSubtypeOf } from "../ontology/types.js";

export interface PathConstraint {
  from: string;
  to: string;
  maxHops: number;
  allowedEdgeKinds?: string[];
  direction?: TraceDirection;
}

export class Oracle {
  private readonly store;
  private readonly index;

  constructor(private readonly dataset: LoadedDataset) {
    this.store = dataset.store;
    this.index = dataset.index;
  }

  node(id: string) {
    const index = this.store.indexOf(id);
    return index === undefined ? undefined : this.store.nodeAt(index);
  }

  findNodeIds(label: string, kind?: string): string[] {
    const needle = label.trim().toLowerCase();
    const candidates = kind
      ? (this.store.nodesByKind.get(kind) ?? [])
      : this.store.nodes.map((_, i) => i);
    return candidates
      .filter((i) => {
        const node = this.store.nodeAt(i);
        return node.label.toLowerCase() === needle;
      })
      .map((i) => this.store.nodeAt(i).id)
      .sort();
  }

  neighbors(
    id: string,
    options: {
      edgeKinds?: string[];
      direction?: TraceDirection;
      neighborKind?: string;
    } = {},
  ): string[] {
    const index = this.store.indexOf(id);
    if (index === undefined) return [];
    return this.store
      .neighbors(index, options)
      .map((hit) => this.store.nodeAt(hit.nodeIndex).id)
      .sort();
  }

  count(
    id: string,
    options: {
      edgeKinds?: string[];
      direction?: TraceDirection;
      neighborKind?: string;
    } = {},
  ): number {
    const index = this.store.indexOf(id);
    if (index === undefined) return 0;
    return this.store.aggregate({
      fromIndex: index,
      edgeKinds: options.edgeKinds,
      direction: options.direction ?? "out",
      targetKind: options.neighborKind,
      groupBy: "edgeKind",
      limit: 1,
    }).total;
  }

  hasPath(constraint: PathConstraint, maxVisited = 200_000): boolean {
    const from = this.store.indexOf(constraint.from);
    const to = this.store.indexOf(constraint.to);
    if (from === undefined || to === undefined) return false;
    if (from === to) return true;
    const direction = constraint.direction ?? "both";
    const maxHops = constraint.maxHops;
    const allowed = constraint.allowedEdgeKinds
      ? new Set(constraint.allowedEdgeKinds)
      : undefined;
    const dist = new Int32Array(this.store.nodeCount).fill(-1);
    dist[from] = 0;
    const queue = [from];
    let head = 0;
    let visited = 0;
    while (head < queue.length) {
      if (visited++ > maxVisited) return false;
      const node = queue[head++]!;
      const d = dist[node]!;
      if (d >= maxHops) continue;
      const expand = (edge: number, dir: "out" | "in") => {
        if (allowed && !allowed.has(this.store.edgeKindAt(edge))) return;
        const next =
          dir === "out"
            ? this.store.edgeTarget[edge]!
            : this.store.edgeSource[edge]!;
        if (dist[next] !== -1) return;
        dist[next] = d + 1;
        queue.push(next);
      };
      if (direction === "out" || direction === "both") {
        for (const edge of this.store.outAdj[node] ?? []) expand(edge, "out");
      }
      if (direction === "in" || direction === "both") {
        for (const edge of this.store.inAdj[node] ?? []) expand(edge, "in");
      }
    }
    return dist[to] !== -1;
  }

  isValidPath(
    nodes: string[],
    edges: string[],
    constraint: PathConstraint,
  ): boolean {
    return this.store.isValidPath(nodes, edges, {
      from: constraint.from,
      to: constraint.to,
      maxHops: constraint.maxHops,
      allowedEdgeKinds: constraint.allowedEdgeKinds,
      direction: constraint.direction ?? "both",
    });
  }

  subtypes(kindId: string): string[] {
    return this.index.ontology.nodeKinds
      .filter((kind) => kind.id !== kindId && isSubtypeOf(this.index, kind.id, kindId))
      .map((kind) => kind.id)
      .sort();
  }

  edgeKindAllows(
    edgeKindId: string,
    sourceKind: string,
    targetKind: string,
  ): boolean {
    const edgeKind = this.index.edgeKindById.get(edgeKindId);
    if (!edgeKind) return false;
    if (edgeAllowsPair(edgeKind, sourceKind, targetKind)) return true;
    return edgeKind.endpoints.some(
      (endpoint) =>
        isSubtypeOf(this.index, sourceKind, endpoint.source) &&
        isSubtypeOf(this.index, targetKind, endpoint.target),
    );
  }

  edgeKindLabel(edgeKindId: string): string {
    return this.index.edgeKindById.get(edgeKindId)?.label ?? edgeKindId;
  }
}
