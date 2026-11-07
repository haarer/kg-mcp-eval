import type { LoadedDataset } from "../../graph/load.js";
import type { GraphNode } from "../../graph/types.js";
import type { EdgeKind, NodeKind } from "../../ontology/types.js";

export const DEFAULT_LIMIT = 25;
export const HARD_LIMIT = 100;
export const MAX_RESULT_BYTES = 32_000;

export function clampLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value as number), HARD_LIMIT));
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { o?: number };
    return Number.isFinite(parsed.o) ? Math.max(0, Math.floor(parsed.o as number)) : 0;
  } catch {
    return 0;
  }
}

export function pickProperties(
  properties: Record<string, unknown> | undefined,
  fields: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!properties || !fields || fields.length === 0) return undefined;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in properties) picked[field] = properties[field];
  }
  return picked;
}

export function compactNode(
  node: GraphNode,
  fields?: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: node.id,
    kind: node.kind,
    label: node.label,
  };
  const properties = pickProperties(node.properties, fields);
  if (properties) result.properties = properties;
  return result;
}

export function boundResult<T extends Record<string, unknown>>(
  result: T,
  keys: string[] = ["items", "paths", "nodes", "groups"],
  offset?: number,
): T {
  if (JSON.stringify(result).length <= MAX_RESULT_BYTES) return result;
  const mutable = result as Record<string, unknown>;
  for (const key of keys) {
    const value = mutable[key];
    if (!Array.isArray(value)) continue;
    while (
      value.length > 0 &&
      JSON.stringify(mutable).length > MAX_RESULT_BYTES
    ) {
      value.pop();
    }
    mutable.truncated = true;
    if (
      offset !== undefined &&
      typeof mutable.total === "number" &&
      Array.isArray(mutable[key])
    ) {
      const next = offset + (mutable[key] as unknown[]).length;
      if (next < mutable.total) mutable.nextCursor = encodeCursor(next);
      else delete mutable.nextCursor;
    }
    if (JSON.stringify(mutable).length <= MAX_RESULT_BYTES) return result;
  }
  return result;
}

export function compactNodeKind(kind: NodeKind, count?: number) {
  return {
    id: kind.id,
    label: kind.label,
    ...(kind.parent ? { parent: kind.parent } : {}),
    ...(kind.abbreviation ? { abbreviation: kind.abbreviation } : {}),
    ...(count === undefined ? {} : { count }),
    ...(kind.description ? { description: kind.description } : {}),
    ...(kind.properties ? { properties: kind.properties } : {}),
  };
}

export function compactEdgeKind(kind: EdgeKind, count?: number) {
  return {
    id: kind.id,
    label: kind.label,
    endpoints: kind.endpoints,
    direction: kind.direction,
    ...(count === undefined ? {} : { count }),
    ...(kind.description ? { description: kind.description } : {}),
    ...(kind.properties ? { properties: kind.properties } : {}),
  };
}

export function schemaResult(
  dataset: LoadedDataset,
  options: {
    nodeKind?: string;
    edgeKind?: string;
    includeProperties?: boolean;
  } = {},
) {
  return schemaFromOntology(
    dataset.ontology,
    dataset.store.kindCounts(),
    {
      nodes: dataset.store.nodeCount,
      edges: dataset.store.edgeCount,
      loadMs: dataset.loadMs,
    },
    options,
  );
}

export function schemaFromOntology(
  ontology: LoadedDataset["ontology"],
  counts: { nodes: Record<string, number>; edges: Record<string, number> },
  meta: { nodes: number; edges: number; loadMs?: number },
  options: {
    nodeKind?: string;
    edgeKind?: string;
    includeProperties?: boolean;
  } = {},
) {
  const nodeKinds = ontology.nodeKinds
    .filter((k) => !options.nodeKind || k.id === options.nodeKind)
    .map((k) => {
      const entry = compactNodeKind(k, counts.nodes[k.id] ?? 0);
      if (!options.includeProperties) delete (entry as Record<string, unknown>).properties;
      return entry;
    });
  const edgeKinds = ontology.edgeKinds
    .filter((k) => {
      if (options.edgeKind) return k.id === options.edgeKind;
      if (!options.nodeKind) return true;
      return k.endpoints.some(
        (e) => e.source === options.nodeKind || e.target === options.nodeKind,
      );
    })
    .map((k) => {
      const entry = compactEdgeKind(k, counts.edges[k.id] ?? 0);
      if (!options.includeProperties) delete (entry as Record<string, unknown>).properties;
      return entry;
    });
  return {
    dataset: {
      name: ontology.name,
      version: ontology.version,
      nodes: meta.nodes,
      edges: meta.edges,
      ...(meta.loadMs === undefined ? {} : { loadMs: meta.loadMs }),
    },
    nodeKinds,
    edgeKinds,
  };
}

export function errorResult(message: string, extra: Record<string, unknown> = {}) {
  return { error: message, ...extra };
}
