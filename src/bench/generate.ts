import type { LoadedDataset } from "../graph/load.js";
import type { TraceDirection } from "../graph/types.js";
import { Oracle } from "../oracle/oracle.js";

export type AnswerType =
  | "id"
  | "id_set"
  | "kind_set"
  | "number"
  | "boolean"
  | "path"
  | "path_exists";

export type TaskCategory =
  | "lookup"
  | "one_hop"
  | "multi_hop"
  | "aggregate"
  | "path"
  | "negative"
  | "se_hierarchy"
  | "se_composition"
  | "se_trace";

export interface Task {
  id: string;
  dataset: "hetionet" | "se-seed";
  category: TaskCategory;
  prompt: string;
  answer_type: AnswerType;
  constraints?: Record<string, unknown>;
  gold: unknown;
}

export interface TaskManifest {
  seed: number;
  generatedAt: string;
  tasks: number;
  byDataset: Record<string, number>;
  byCategory: Record<string, number>;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rng: () => number): T {
  if (items.length === 0) throw new Error("Cannot pick from empty array");
  return items[Math.floor(rng() * items.length)]!;
}

function labelCounts(dataset: LoadedDataset): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of dataset.store.nodes) {
    const key = node.label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const READABLE_KINDS = new Set([
  "Anatomy",
  "Biological Process",
  "Cellular Component",
  "Compound",
  "Disease",
  "Gene",
  "Molecular Function",
  "Pathway",
  "Pharmacologic Class",
  "Side Effect",
  "Symptom",
]);

function readableNodes(
  dataset: LoadedDataset,
  counts: Map<string, number>,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < dataset.store.nodes.length; i += 1) {
    const node = dataset.store.nodeAt(i);
    if (!READABLE_KINDS.has(node.kind)) continue;
    if (node.label.length < 3 || node.label.length > 80) continue;
    if ((counts.get(node.label.toLowerCase()) ?? 0) !== 1) continue;
    result.push(i);
  }
  return result;
}

function buildEdgeIndex(store: LoadedDataset["store"]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let e = 0; e < store.edgeKind.length; e += 1) {
    const kind = store.edgeKindAt(e);
    let list = index.get(kind);
    if (!list) {
      list = [];
      index.set(kind, list);
    }
    list.push(e);
  }
  return index;
}

function nodeId(store: LoadedDataset["store"], index: number): string {
  return store.nodeAt(index).id;
}

function nodeLabel(store: LoadedDataset["store"], index: number): string {
  return store.nodeAt(index).label;
}

interface HopPair {
  source: number;
  target: number;
  distance: number;
  path: string[];
  edgeKinds: string[];
}

function pickHopPair(
  dataset: LoadedDataset,
  readable: number[],
  counts: Map<string, number>,
  rng: () => number,
  minDistance = 2,
  maxDistance = 3,
): HopPair | undefined {
  const store = dataset.store;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const source = pick(readable, rng);
    const degree = (store.outAdj[source]?.length ?? 0) + (store.inAdj[source]?.length ?? 0);
    if (degree > 30) continue;
    const dist = new Int32Array(store.nodeCount).fill(-1);
    const queue = [source];
    dist[source] = 0;
    let head = 0;
    const found: number[] = [];
    while (head < queue.length && queue.length < 5000) {
      const node = queue[head++]!;
      const d = dist[node]!;
      if (d >= maxDistance) continue;
      const expand = (next: number) => {
        if (dist[next] !== -1) return;
        dist[next] = d + 1;
        queue.push(next);
        if (dist[next]! >= minDistance) found.push(next);
      };
      for (const e of store.outAdj[node] ?? []) expand(store.edgeTarget[e]!);
      for (const e of store.inAdj[node] ?? []) expand(store.edgeSource[e]!);
    }
    if (found.length === 0) continue;
    const target = pick(found, rng);
    if (target === source) continue;
    const targetNode = store.nodeAt(target);
    if (targetNode.label.length < 3 || targetNode.label.length > 80) continue;
    if ((counts.get(targetNode.label.toLowerCase()) ?? 0) !== 1) continue;
    const result = store.path(source, target, {
      direction: "both",
      maxHops: dist[target]!,
      limit: 1,
    });
    if (result.paths.length === 0) continue;
    const path = result.paths[0]!;
    return {
      source,
      target,
      distance: dist[target]!,
      path: path.nodes,
      edgeKinds: [...new Set(path.edges)],
    };
  }
  return undefined;
}

export function generateHetionetTasks(
  dataset: LoadedDataset,
  seed = 20261107,
): Task[] {
  const rng = mulberry32(seed);
  const store = dataset.store;
  const oracle = new Oracle(dataset);
  const counts = labelCounts(dataset);
  const readable = readableNodes(dataset, counts);
  const edgeIndex = buildEdgeIndex(store);
  const edgeKindIds = [...edgeIndex.keys()];
  const tasks: Task[] = [];
  const usedLookup = new Set<string>();
  const usedPairs = new Set<string>();

  const edgeLabel = (kind: string) => oracle.edgeKindLabel(kind);

  // Lookup tasks.
  for (let i = 0; i < 8; i += 1) {
    let source = pick(readable, rng);
    let attempts = 0;
    while (usedLookup.has(store.nodeAt(source).id) && attempts++ < 100) {
      source = pick(readable, rng);
    }
    const node = store.nodeAt(source);
    usedLookup.add(node.id);
    tasks.push({
      id: `het-lookup-${String(i + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "lookup",
      prompt: `Find the ${node.kind} node named "${node.label}". Return its typed ID.`,
      answer_type: "id",
      gold: node.id,
    });
  }

  // One-hop tasks.
  const usedOneHop = new Set<string>();
  let oneHopAttempts = 0;
  const oneHopCount = () =>
    tasks.filter((task) => task.category === "one_hop").length;
  while (oneHopCount() < 8 && oneHopAttempts++ < 5000) {
    let chosen:
      | { kind: string; source: number; targets: number[] }
      | undefined;
    for (let attempt = 0; attempt < 800 && !chosen; attempt += 1) {
      const kind = pick(edgeKindIds, rng);
      const edges = edgeIndex.get(kind)!;
      const edge = pick(edges, rng);
      const source = store.edgeSource[edge]!;
      const sourceNode = store.nodeAt(source);
      if ((counts.get(sourceNode.label.toLowerCase()) ?? 0) !== 1) continue;
      if (sourceNode.label.length < 3 || sourceNode.label.length > 80) continue;
      const hits = store.neighbors(source, {
        direction: "out",
        edgeKinds: [kind],
      });
      if (hits.length < 1 || hits.length > 10) continue;
      const targetKinds = new Set(hits.map((h) => store.nodeAt(h.nodeIndex).kind));
      if (targetKinds.size !== 1) continue;
      chosen = {
        kind,
        source,
        targets: hits.map((h) => h.nodeIndex),
      };
    }
    if (!chosen) continue;
    const key = `${chosen.source}-${chosen.kind}`;
    if (usedOneHop.has(key)) continue;
    usedOneHop.add(key);
    const targetKind = store.nodeAt(chosen.targets[0]!).kind;
    tasks.push({
      id: `het-onehop-${String(oneHopCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "one_hop",
      prompt: `List the typed IDs of ${targetKind} nodes reached from ${nodeLabel(store, chosen.source)} (${nodeId(store, chosen.source)}) by outgoing "${edgeLabel(chosen.kind)}" edges.`,
      answer_type: "id_set",
      constraints: {
        from: nodeId(store, chosen.source),
        edgeKinds: [chosen.kind],
        direction: "out",
        neighborKind: targetKind,
      },
      gold: chosen.targets.map((t) => nodeId(store, t)).sort(),
    });
  }

  // Multi-hop path tasks.
  const multiHopCount = () =>
    tasks.filter((task) => task.category === "multi_hop").length;
  let multiHopAttempts = 0;
  while (multiHopCount() < 6 && multiHopAttempts++ < 2000) {
    const pair = pickHopPair(dataset, readable, counts, rng, 2, 3);
    if (!pair) continue;
    const key = `${pair.source}-${pair.target}`;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    tasks.push({
      id: `het-multihop-${String(multiHopCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "multi_hop",
      prompt: `Give one path from ${nodeLabel(store, pair.source)} (${nodeId(store, pair.source)}) to ${nodeLabel(store, pair.target)} (${nodeId(store, pair.target)}) using at most ${pair.distance} hops. Edges may be traversed in either direction. Return the node IDs in order and the edge kinds used.`,
      answer_type: "path",
      constraints: {
        from: nodeId(store, pair.source),
        to: nodeId(store, pair.target),
        maxHops: pair.distance,
        direction: "both",
      },
      gold: {
        from: nodeId(store, pair.source),
        to: nodeId(store, pair.target),
        maxHops: pair.distance,
        direction: "both",
      },
    });
  }

  // Aggregate tasks.
  const usedAggregate = new Set<string>();
  const aggregateCount = () =>
    tasks.filter((task) => task.category === "aggregate").length;
  let aggregateAttempts = 0;
  while (aggregateCount() < 6 && aggregateAttempts++ < 3000) {
    let chosen: { source: number; kind: string; count: number } | undefined;
    for (let attempt = 0; attempt < 800 && !chosen; attempt += 1) {
      const kind = pick(edgeKindIds, rng);
      const edges = edgeIndex.get(kind)!;
      const edge = pick(edges, rng);
      const source = store.edgeSource[edge]!;
      const node = store.nodeAt(source);
      if ((counts.get(node.label.toLowerCase()) ?? 0) !== 1) continue;
      const count = store.aggregate({
        fromIndex: source,
        direction: "out",
        edgeKinds: [kind],
        groupBy: "edgeKind",
        limit: 1,
      }).total;
      if (count < 2 || count > 100) continue;
      chosen = { source, kind, count };
    }
    if (!chosen) continue;
    const key = `${chosen.source}-${chosen.kind}`;
    if (usedAggregate.has(key)) continue;
    usedAggregate.add(key);
    tasks.push({
      id: `het-aggregate-${String(aggregateCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "aggregate",
      prompt: `How many outgoing "${edgeLabel(chosen.kind)}" edges does ${nodeLabel(store, chosen.source)} (${nodeId(store, chosen.source)}) have? Return a number.`,
      answer_type: "number",
      constraints: {
        from: nodeId(store, chosen.source),
        edgeKinds: [chosen.kind],
        direction: "out",
      },
      gold: chosen.count,
    });
  }

  // Path existence tasks (4 true, 2 false).
  const truePathCount = () =>
    tasks.filter(
      (task) =>
        task.category === "path" &&
        (task.gold as { exists?: boolean }).exists === true,
    ).length;
  let truePathAttempts = 0;
  while (truePathCount() < 4 && truePathAttempts++ < 1000) {
    const pair = pickHopPair(dataset, readable, counts, rng, 2, 4);
    if (!pair) continue;
    const key = `${pair.source}-${pair.target}`;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    tasks.push({
      id: `het-path-${String(truePathCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "path",
      prompt: `Is there a path from ${nodeLabel(store, pair.source)} (${nodeId(store, pair.source)}) to ${nodeLabel(store, pair.target)} (${nodeId(store, pair.target)}) using only edge kinds [${pair.edgeKinds.map((k) => `"${edgeLabel(k)}"`).join(", ")}] within ${pair.distance} hops? Edges may be traversed in either direction. Answer true or false, and if true give one path.`,
      answer_type: "path_exists",
      constraints: {
        from: nodeId(store, pair.source),
        to: nodeId(store, pair.target),
        maxHops: pair.distance,
        edgeKinds: pair.edgeKinds,
        direction: "both",
      },
      gold: {
        from: nodeId(store, pair.source),
        to: nodeId(store, pair.target),
        maxHops: pair.distance,
        allowedEdgeKinds: pair.edgeKinds,
        direction: "both",
        exists: true,
      },
    });
  }
  const falsePathCount = () =>
    tasks.filter(
      (task) =>
        task.category === "path" &&
        (task.gold as { exists?: boolean }).exists === false,
    ).length;
  let falsePathAttempts = 0;
  while (falsePathCount() < 2 && falsePathAttempts++ < 1000) {
    let found:
      | { from: string; to: string; kind: string; maxHops: number }
      | undefined;
    for (let attempt = 0; attempt < 500 && !found; attempt += 1) {
      const a = pick(readable, rng);
      const b = pick(readable, rng);
      if (a === b) continue;
      const kind = pick(edgeKindIds, rng);
      const maxHops = 2;
      const key = `${a}-${b}-${kind}`;
      if (usedPairs.has(key)) continue;
      const exists = oracle.hasPath({
        from: nodeId(store, a),
        to: nodeId(store, b),
        maxHops,
        allowedEdgeKinds: [kind],
        direction: "both",
      });
      if (!exists) {
        usedPairs.add(key);
        found = {
          from: nodeId(store, a),
          to: nodeId(store, b),
          kind,
          maxHops,
        };
      }
    }
    if (!found) continue;
    tasks.push({
      id: `het-path-${String(truePathCount() + falsePathCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "path",
      prompt: `Is there a path from ${nodeLabel(store, store.indexOf(found.from)!)} (${found.from}) to ${nodeLabel(store, store.indexOf(found.to)!)} (${found.to}) using only "${edgeLabel(found.kind)}" edges within ${found.maxHops} hops? Edges may be traversed in either direction. Answer true or false, and if true give one path.`,
      answer_type: "path_exists",
      constraints: {
        from: found.from,
        to: found.to,
        maxHops: found.maxHops,
        edgeKinds: [found.kind],
        direction: "both",
      },
      gold: {
        from: found.from,
        to: found.to,
        maxHops: found.maxHops,
        allowedEdgeKinds: [found.kind],
        direction: "both",
        exists: false,
      },
    });
  }

  // Ontology-boundary tasks (2 allowed, 2 disallowed).
  const nodeKinds = dataset.ontology.nodeKinds.map((k) => k.id);
  const edgeKinds = dataset.ontology.edgeKinds.map((k) => k.id);
  const targets: boolean[] = [true, true, false, false];
  const usedNegative = new Set<string>();
  const negativeCount = () =>
    tasks.filter(
      (task) =>
        task.category === "negative" && task.dataset === "hetionet",
    ).length;
  let negativeAttempts = 0;
  while (negativeCount() < 4 && negativeAttempts++ < 3000) {
    const want = targets[negativeCount()]!;
    let chosen:
      | { kind: string; sourceKind: string; targetKind: string; allowed: boolean }
      | undefined;
    for (let attempt = 0; attempt < 500 && !chosen; attempt += 1) {
      const kind = pick(edgeKinds, rng);
      const sourceKind = pick(nodeKinds, rng);
      const targetKind = pick(nodeKinds, rng);
      const allowed = oracle.edgeKindAllows(kind, sourceKind, targetKind);
      if (allowed === want) chosen = { kind, sourceKind, targetKind, allowed };
    }
    if (!chosen) continue;
    const key = `${chosen.kind}-${chosen.sourceKind}-${chosen.targetKind}`;
    if (usedNegative.has(key)) continue;
    usedNegative.add(key);
    tasks.push({
      id: `het-negative-${String(negativeCount() + 1).padStart(2, "0")}`,
      dataset: "hetionet",
      category: "negative",
      prompt: `In this ontology, is it valid for a ${chosen.sourceKind} node to be the source of an outgoing "${edgeLabel(chosen.kind)}" edge to a ${chosen.targetKind} node? Answer true or false.`,
      answer_type: "boolean",
      constraints: {
        edgeKind: chosen.kind,
        sourceKind: chosen.sourceKind,
        targetKind: chosen.targetKind,
      },
      gold: chosen.allowed,
    });
  }

  return tasks;
}

export function generateSeSeedTasks(dataset: LoadedDataset): Task[] {
  const oracle = new Oracle(dataset);
  const store = dataset.store;
  const satisfiesFromFcc = oracle.neighbors("C-FCC", {
    edgeKinds: ["satisfies"],
    direction: "out",
  });
  const testsForFcc = satisfiesFromFcc
    .flatMap((req) =>
      oracle.neighbors(req, { edgeKinds: ["verifies"], direction: "in" }),
    )
    .sort();
  const contained = oracle.neighbors("SYS-FCS", {
    edgeKinds: ["contains"],
    direction: "out",
  });

  return [
    {
      id: "se-hierarchy-01",
      dataset: "se-seed",
      category: "se_hierarchy",
      prompt:
        "Which node kinds are direct or indirect subtypes of Component? Return a JSON array of kind IDs.",
      answer_type: "kind_set",
      gold: oracle.subtypes("Component"),
    },
    {
      id: "se-hierarchy-02",
      dataset: "se-seed",
      category: "se_hierarchy",
      prompt:
        "Is SoftwareComponent a subtype of Element in this ontology? Answer true or false.",
      answer_type: "boolean",
      gold: true,
    },
    {
      id: "se-composition-01",
      dataset: "se-seed",
      category: "se_composition",
      prompt:
        "Which components are directly contained by the UAV Flight Control System (SYS-FCS)? Return their typed IDs.",
      answer_type: "id_set",
      constraints: { from: "SYS-FCS", edgeKinds: ["contains"], direction: "out" },
      gold: contained,
    },
    {
      id: "se-composition-02",
      dataset: "se-seed",
      category: "se_composition",
      prompt:
        "Which test cases verify requirements that are satisfied by the Flight Control Computer (C-FCC)? Return their typed IDs.",
      answer_type: "id_set",
      constraints: {
        from: "C-FCC",
        via: ["satisfies", "verifies"],
        direction: "both",
      },
      gold: testsForFcc,
    },
    {
      id: "se-trace-01",
      dataset: "se-seed",
      category: "se_trace",
      prompt:
        "Give one path from R-003 to T-003 using verifies edges, traversing edges in either direction. Return the node IDs in order and the edge kinds used.",
      answer_type: "path",
      constraints: {
        from: "R-003",
        to: "T-003",
        maxHops: 1,
        edgeKinds: ["verifies"],
        direction: "both",
      },
      gold: {
        from: "R-003",
        to: "T-003",
        maxHops: 1,
        direction: "both",
      },
    },
    {
      id: "se-negative-01",
      dataset: "se-seed",
      category: "negative",
      prompt:
        "Can a TestCase satisfy a Function in this ontology? Answer true or false.",
      answer_type: "boolean",
      constraints: {
        edgeKind: "satisfies",
        sourceKind: "TestCase",
        targetKind: "Function",
      },
      gold: oracle.edgeKindAllows("satisfies", "TestCase", "Function"),
    },
  ];
}

export function generateAllTasks(
  hetionet: LoadedDataset,
  seSeed: LoadedDataset,
  seed = 20261107,
): { tasks: Task[]; manifest: TaskManifest } {
  const tasks = [
    ...generateHetionetTasks(hetionet, seed),
    ...generateSeSeedTasks(seSeed),
  ];
  const byDataset: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const task of tasks) {
    byDataset[task.dataset] = (byDataset[task.dataset] ?? 0) + 1;
    byCategory[task.category] = (byCategory[task.category] ?? 0) + 1;
  }
  return {
    tasks,
    manifest: {
      seed,
      generatedAt: new Date().toISOString(),
      tasks: tasks.length,
      byDataset,
      byCategory,
    },
  };
}

export type { TraceDirection };
