import type {
  GraphEdgeInput,
  GraphNode,
  GraphNodeInput,
  NeighborHit,
  PathResult,
  TraceDirection,
} from "./types.js";

export interface PathOptions {
  direction?: TraceDirection;
  allowedEdgeKinds?: Set<string> | string[];
  maxHops?: number;
  limit?: number;
  maxVisited?: number;
}

export interface PathSearchResult {
  paths: PathResult[];
  truncated: boolean;
  visited: number;
}

export interface NeighborOptions {
  direction?: TraceDirection;
  edgeKinds?: Set<string> | string[];
  neighborKind?: string;
}

export interface AggregateOptions {
  fromIndex?: number;
  direction?: TraceDirection;
  edgeKinds?: Set<string> | string[];
  sourceKind?: string;
  targetKind?: string;
  groupBy?: "edgeKind" | "sourceKind" | "targetKind" | "neighborKind";
  limit?: number;
}

export interface AggregateGroup {
  key: string;
  count: number;
}

export interface AggregateResult {
  total: number;
  groups: AggregateGroup[];
}

const TOKEN_RE = /[a-z0-9]+/g;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

function toSet(
  value: Set<string> | string[] | undefined,
): Set<string> | undefined {
  if (!value) return undefined;
  return value instanceof Set ? value : new Set(value);
}

export class GraphBuilder {
  readonly nodes: GraphNode[] = [];
  readonly idToIndex = new Map<string, number>();
  private readonly sources: number[] = [];
  private readonly targets: number[] = [];
  private readonly kinds: number[] = [];
  readonly edgeKindIds: string[] = [];
  readonly edgeKindToIndex = new Map<string, number>();

  addNode(node: GraphNodeInput): number {
    if (this.idToIndex.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    const index = this.nodes.length;
    this.nodes.push({ ...node });
    this.idToIndex.set(node.id, index);
    return index;
  }

  addEdge(edge: GraphEdgeInput): void {
    const source = this.idToIndex.get(edge.source);
    const target = this.idToIndex.get(edge.target);
    if (source === undefined) {
      throw new Error(`Edge references unknown source: ${edge.source}`);
    }
    if (target === undefined) {
      throw new Error(`Edge references unknown target: ${edge.target}`);
    }
    let kind = this.edgeKindToIndex.get(edge.kind);
    if (kind === undefined) {
      kind = this.edgeKindIds.length;
      this.edgeKindIds.push(edge.kind);
      this.edgeKindToIndex.set(edge.kind, kind);
    }
    this.sources.push(source);
    this.targets.push(target);
    this.kinds.push(kind);
  }

  addEdgeByIndex(source: number, target: number, kindId: string): void {
    let kind = this.edgeKindToIndex.get(kindId);
    if (kind === undefined) {
      kind = this.edgeKindIds.length;
      this.edgeKindIds.push(kindId);
      this.edgeKindToIndex.set(kindId, kind);
    }
    this.sources.push(source);
    this.targets.push(target);
    this.kinds.push(kind);
  }

  finish(): GraphStore {
    return new GraphStore(
      this.nodes,
      Int32Array.from(this.sources),
      Int32Array.from(this.targets),
      Uint16Array.from(this.kinds),
      this.edgeKindIds,
    );
  }
}

export class GraphStore {
  readonly nodes: GraphNode[];
  readonly idToIndex: Map<string, number>;
  readonly nodesByKind: Map<string, number[]>;
  readonly edgeSource: Int32Array;
  readonly edgeTarget: Int32Array;
  readonly edgeKind: Uint16Array;
  readonly edgeKindIds: string[];
  readonly edgeKindToIndex: Map<string, number>;
  readonly outAdj: number[][];
  readonly inAdj: number[][];
  private readonly tokenIndex: Map<string, number[]>;

  constructor(
    nodes: GraphNode[],
    edgeSource: Int32Array,
    edgeTarget: Int32Array,
    edgeKind: Uint16Array,
    edgeKindIds: string[],
  ) {
    this.nodes = nodes;
    this.edgeSource = edgeSource;
    this.edgeTarget = edgeTarget;
    this.edgeKind = edgeKind;
    this.edgeKindIds = edgeKindIds;
    this.idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    this.edgeKindToIndex = new Map(edgeKindIds.map((k, i) => [k, i]));

    this.nodesByKind = new Map();
    for (let i = 0; i < nodes.length; i += 1) {
      const kind = nodes[i]!.kind;
      let list = this.nodesByKind.get(kind);
      if (!list) {
        list = [];
        this.nodesByKind.set(kind, list);
      }
      list.push(i);
    }

    this.outAdj = Array.from({ length: nodes.length }, () => [] as number[]);
    this.inAdj = Array.from({ length: nodes.length }, () => [] as number[]);
    for (let e = 0; e < edgeSource.length; e += 1) {
      this.outAdj[edgeSource[e]!]!.push(e);
      this.inAdj[edgeTarget[e]!]!.push(e);
    }

    this.tokenIndex = new Map();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      const tokens = new Set([
        ...tokenize(node.label),
        ...tokenize(node.id),
      ]);
      for (const token of tokens) {
        let posting = this.tokenIndex.get(token);
        if (!posting) {
          posting = [];
          this.tokenIndex.set(token, posting);
        }
        posting.push(i);
      }
    }
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  get edgeCount(): number {
    return this.edgeSource.length;
  }

  nodeAt(index: number): GraphNode {
    const node = this.nodes[index];
    if (!node) throw new Error(`Node index out of range: ${index}`);
    return node;
  }

  indexOf(id: string): number | undefined {
    return this.idToIndex.get(id);
  }

  edgeKindAt(edgeIndex: number): string {
    return this.edgeKindIds[this.edgeKind[edgeIndex]!]!;
  }

  kindCounts(): { nodes: Record<string, number>; edges: Record<string, number> } {
    const nodes: Record<string, number> = {};
    for (const [kind, list] of this.nodesByKind) nodes[kind] = list.length;
    const edges: Record<string, number> = {};
    for (let e = 0; e < this.edgeKind.length; e += 1) {
      const kind = this.edgeKindAt(e);
      edges[kind] = (edges[kind] ?? 0) + 1;
    }
    return { nodes, edges };
  }

  search(
    query: string,
    options: { kind?: string; limit: number; offset: number },
  ): { hits: number[]; total: number } {
    const kind = options.kind;
    const q = query.trim().toLowerCase();
    let candidates: number[] | undefined;

    if (q.length === 0) {
      candidates = kind
        ? (this.nodesByKind.get(kind) ?? [])
        : this.nodes.map((_, i) => i);
    } else {
      const tokens = tokenize(q);
      if (tokens.length > 0) {
        const postings = tokens
          .map((t) => this.tokenIndex.get(t))
          .filter((p): p is number[] => Boolean(p))
          .sort((a, b) => a.length - b.length);
        if (postings.length === tokens.length) {
          const [first, ...rest] = postings;
          const restSets = rest.map((p) => new Set(p));
          candidates = (first ?? []).filter((i) => restSets.every((s) => s.has(i)));
        } else {
          candidates = [];
        }
      } else {
        candidates = kind
          ? (this.nodesByKind.get(kind) ?? [])
          : this.nodes.map((_, i) => i);
      }
      const needle = q.replace(/\s+/g, " ");
      candidates = candidates.filter((i) => {
        const node = this.nodes[i]!;
        const haystack = `${node.label} ${node.id}`.toLowerCase();
        return haystack.includes(needle) || tokens.every((t) => haystack.includes(t));
      });
    }

    if (kind) {
      candidates = candidates.filter((i) => this.nodes[i]!.kind === kind);
    }
    candidates.sort((a, b) => {
      const na = this.nodes[a]!;
      const nb = this.nodes[b]!;
      return na.label.localeCompare(nb.label) || na.id.localeCompare(nb.id);
    });
    return {
      hits: candidates.slice(options.offset, options.offset + options.limit),
      total: candidates.length,
    };
  }

  neighbors(nodeIndex: number, options: NeighborOptions = {}): NeighborHit[] {
    const direction = options.direction ?? "both";
    const edgeKinds = toSet(options.edgeKinds);
    const hits: NeighborHit[] = [];
    const visit = (edgeIndex: number, dir: "out" | "in") => {
      const kind = this.edgeKindAt(edgeIndex);
      if (edgeKinds && !edgeKinds.has(kind)) return;
      const neighbor =
        dir === "out" ? this.edgeTarget[edgeIndex]! : this.edgeSource[edgeIndex]!;
      if (
        options.neighborKind &&
        this.nodes[neighbor]!.kind !== options.neighborKind
      ) {
        return;
      }
      hits.push({ edgeIndex, edgeKind: kind, direction: dir, nodeIndex: neighbor });
    };
    if (direction === "out" || direction === "both") {
      for (const e of this.outAdj[nodeIndex] ?? []) visit(e, "out");
    }
    if (direction === "in" || direction === "both") {
      for (const e of this.inAdj[nodeIndex] ?? []) visit(e, "in");
    }
    hits.sort((a, b) => {
      const na = this.nodes[a.nodeIndex]!;
      const nb = this.nodes[b.nodeIndex]!;
      return (
        a.edgeKind.localeCompare(b.edgeKind) ||
        na.label.localeCompare(nb.label) ||
        na.id.localeCompare(nb.id)
      );
    });
    return hits;
  }

  path(fromIndex: number, toIndex: number, options: PathOptions = {}): PathSearchResult {
    const direction = options.direction ?? "both";
    const allowed = toSet(options.allowedEdgeKinds);
    const maxHops = Math.min(Math.max(options.maxHops ?? 4, 1), 6);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const maxVisited = options.maxVisited ?? 200_000;
    if (fromIndex === toIndex) {
      return { paths: [{ nodes: [this.nodeAt(fromIndex).id], edges: [] }], truncated: false, visited: 1 };
    }

    const n = this.nodes.length;
    const dist = new Int32Array(n).fill(-1);
    const preds = new Map<number, { prev: number; edge: number }[]>();
    const queue: number[] = [fromIndex];
    dist[fromIndex] = 0;
    let head = 0;
    let visited = 0;
    let targetDist = -1;
    let truncated = false;

    const expand = (node: number, edge: number, dir: "out" | "in") => {
      const next =
        dir === "out" ? this.edgeTarget[edge]! : this.edgeSource[edge]!;
      const kind = this.edgeKindAt(edge);
      if (allowed && !allowed.has(kind)) return;
      const d = dist[node]! + 1;
      if (targetDist !== -1 && d > targetDist) return;
      if (dist[next] === -1) {
        dist[next] = d;
        queue.push(next);
        visited += 1;
      }
      if (dist[next] === d) {
        let list = preds.get(next);
        if (!list) {
          list = [];
          preds.set(next, list);
        }
        list.push({ prev: node, edge });
      }
    };

    while (head < queue.length) {
      if (visited > maxVisited) {
        truncated = true;
        break;
      }
      const node = queue[head++]!;
      const d = dist[node]!;
      if (d >= maxHops) continue;
      if (targetDist !== -1 && d >= targetDist) continue;
      if (direction === "out" || direction === "both") {
        for (const edge of this.outAdj[node] ?? []) expand(node, edge, "out");
      }
      if (direction === "in" || direction === "both") {
        for (const edge of this.inAdj[node] ?? []) expand(node, edge, "in");
      }
      if (node === toIndex && targetDist === -1) targetDist = dist[node]!;
    }

    if (dist[toIndex] === -1) {
      return { paths: [], truncated, visited };
    }

    const paths: PathResult[] = [];
    const build = (
      node: number,
      reversedNodes: number[],
      reversedEdges: number[],
    ) => {
      if (paths.length >= limit) return;
      if (node === fromIndex) {
        paths.push({
          nodes: [...reversedNodes, node].reverse().map((i) => this.nodeAt(i).id),
          edges: [...reversedEdges].reverse().map((e) => this.edgeKindAt(e)),
        });
        return;
      }
      for (const pred of preds.get(node) ?? []) {
        if (dist[pred.prev] !== dist[node]! - 1) continue;
        build(pred.prev, [...reversedNodes, node], [...reversedEdges, pred.edge]);
        if (paths.length >= limit) return;
      }
    };
    build(toIndex, [], []);
    return { paths, truncated, visited };
  }

  isValidPath(
    nodeIds: string[],
    edgeKinds: string[],
    constraints: {
      from: string;
      to: string;
      maxHops: number;
      allowedEdgeKinds?: Set<string> | string[];
      direction?: TraceDirection;
    },
  ): boolean {
    if (nodeIds.length === 0) return false;
    if (nodeIds[0] !== constraints.from || nodeIds.at(-1) !== constraints.to) {
      return false;
    }
    if (nodeIds.length - 1 > constraints.maxHops) return false;
    if (edgeKinds.length !== nodeIds.length - 1) return false;
    const allowed = toSet(constraints.allowedEdgeKinds);
    const direction = constraints.direction ?? "both";
    for (let i = 0; i < edgeKinds.length; i += 1) {
      const a = this.idToIndex.get(nodeIds[i]!);
      const b = this.idToIndex.get(nodeIds[i + 1]!);
      if (a === undefined || b === undefined) return false;
      const kind = edgeKinds[i]!;
      if (allowed && !allowed.has(kind)) return false;
      let ok = false;
      if (direction === "out" || direction === "both") {
        ok ||= (this.outAdj[a] ?? []).some(
          (e) => this.edgeTarget[e] === b && this.edgeKindAt(e) === kind,
        );
      }
      if (!ok && (direction === "in" || direction === "both")) {
        ok = (this.inAdj[a] ?? []).some(
          (e) => this.edgeSource[e] === b && this.edgeKindAt(e) === kind,
        );
      }
      if (!ok) return false;
    }
    return true;
  }

  aggregate(options: AggregateOptions = {}): AggregateResult {
    const direction = options.direction ?? "out";
    const edgeKinds = toSet(options.edgeKinds);
    const groupBy = options.groupBy ?? "edgeKind";
    const groups = new Map<string, number>();
    let total = 0;

    const bump = (key: string) => {
      total += 1;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    };

    if (options.fromIndex !== undefined) {
      const from = options.fromIndex;
      const visit = (edge: number, dir: "out" | "in") => {
        const kind = this.edgeKindAt(edge);
        if (edgeKinds && !edgeKinds.has(kind)) return;
        const other =
          dir === "out" ? this.edgeTarget[edge]! : this.edgeSource[edge]!;
        const sourceIdx = dir === "out" ? from : other;
        const targetIdx = dir === "out" ? other : from;
        if (options.sourceKind && this.nodes[sourceIdx]!.kind !== options.sourceKind) return;
        if (options.targetKind && this.nodes[targetIdx]!.kind !== options.targetKind) return;
        let key: string;
        switch (groupBy) {
          case "sourceKind":
            key = this.nodes[sourceIdx]!.kind;
            break;
          case "targetKind":
            key = this.nodes[targetIdx]!.kind;
            break;
          case "neighborKind":
            key = this.nodes[other]!.kind;
            break;
          default:
            key = kind;
        }
        bump(key);
      };
      if (direction === "out" || direction === "both") {
        for (const e of this.outAdj[from] ?? []) visit(e, "out");
      }
      if (direction === "in" || direction === "both") {
        for (const e of this.inAdj[from] ?? []) visit(e, "in");
      }
    } else {
      for (let e = 0; e < this.edgeKind.length; e += 1) {
        const kind = this.edgeKindAt(e);
        if (edgeKinds && !edgeKinds.has(kind)) continue;
        const sourceIdx = this.edgeSource[e]!;
        const targetIdx = this.edgeTarget[e]!;
        if (options.sourceKind && this.nodes[sourceIdx]!.kind !== options.sourceKind) continue;
        if (options.targetKind && this.nodes[targetIdx]!.kind !== options.targetKind) continue;
        let key: string;
        switch (groupBy) {
          case "sourceKind":
            key = this.nodes[sourceIdx]!.kind;
            break;
          case "targetKind":
          case "neighborKind":
            key = this.nodes[targetIdx]!.kind;
            break;
          default:
            key = kind;
        }
        bump(key);
      }
    }

    const sorted = [...groups.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return { total, groups: sorted.slice(0, options.limit ?? 50) };
  }
}
