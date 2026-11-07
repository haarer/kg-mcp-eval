import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LoadedDataset } from "../../graph/load.js";
import type { TraceDirection } from "../../graph/types.js";
import {
  boundResult,
  clampLimit,
  compactNode,
  decodeCursor,
  encodeCursor,
  errorResult,
  schemaResult,
} from "./common.js";

const directionSchema = z.enum(["out", "in", "both"]);

function unknownKinds(dataset: LoadedDataset, edgeKinds?: string[]): string[] {
  return (edgeKinds ?? []).filter((k) => !dataset.index.edgeKindById.has(k));
}

function unknownNodeKind(dataset: LoadedDataset, kind?: string): boolean {
  return Boolean(kind && !dataset.index.nodeKindById.has(kind));
}

export function createArmA(dataset: LoadedDataset) {
  const { store } = dataset;

  return {
    schema(args: {
      nodeKind?: string;
      edgeKind?: string;
      includeProperties?: boolean;
    }) {
      if (unknownNodeKind(dataset, args.nodeKind)) {
        return errorResult(`Unknown node kind: ${args.nodeKind}`, {
          validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
        });
      }
      if (
        args.edgeKind &&
        !dataset.index.edgeKindById.has(args.edgeKind)
      ) {
        return errorResult(`Unknown edge kind: ${args.edgeKind}`, {
          validEdgeKinds: dataset.ontology.edgeKinds.map((k) => k.id),
        });
      }
      return schemaResult(dataset, args);
    },

    search(args: {
      query?: string;
      kind?: string;
      limit?: number;
      cursor?: string;
      fields?: string[];
    }) {
      if (unknownNodeKind(dataset, args.kind)) {
        return errorResult(`Unknown node kind: ${args.kind}`, {
          validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
        });
      }
      const limit = clampLimit(args.limit);
      const offset = decodeCursor(args.cursor);
      const { hits, total } = store.search(args.query ?? "", {
        kind: args.kind,
        limit,
        offset,
      });
      const nextOffset = offset + hits.length;
      return boundResult(
        {
          items: hits.map((i) => compactNode(store.nodeAt(i), args.fields)),
          total,
          ...(nextOffset < total ? { nextCursor: encodeCursor(nextOffset) } : {}),
        },
        undefined,
        offset,
      );
    },

    node(args: { ids: string[]; fields?: string[] }) {
      const ids = args.ids.slice(0, 100);
      const nodes = [];
      const missing: string[] = [];
      for (const id of ids) {
        const index = store.indexOf(id);
        if (index === undefined) {
          missing.push(id);
        } else {
          nodes.push(compactNode(store.nodeAt(index), args.fields));
        }
      }
      return { nodes, missing };
    },

    neighbors(args: {
      id: string;
      edgeKinds?: string[];
      direction?: TraceDirection;
      neighborKind?: string;
      limit?: number;
      cursor?: string;
      fields?: string[];
    }) {
      const index = store.indexOf(args.id);
      if (index === undefined) {
        return errorResult(`Unknown node id: ${args.id}`);
      }
      if (unknownNodeKind(dataset, args.neighborKind)) {
        return errorResult(`Unknown node kind: ${args.neighborKind}`, {
          validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
        });
      }
      const unknown = unknownKinds(dataset, args.edgeKinds);
      if (unknown.length > 0) {
        return errorResult(`Unknown edge kinds: ${unknown.join(", ")}`, {
          validEdgeKinds: dataset.ontology.edgeKinds.map((k) => k.id),
        });
      }
      const limit = clampLimit(args.limit);
      const offset = decodeCursor(args.cursor);
      const hits = store.neighbors(index, {
        direction: args.direction ?? "both",
        edgeKinds: args.edgeKinds,
        neighborKind: args.neighborKind,
      });
      const page = hits.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return boundResult(
        {
          items: page.map((hit) => ({
            edgeKind: hit.edgeKind,
            direction: hit.direction,
            node: compactNode(store.nodeAt(hit.nodeIndex), args.fields),
          })),
          total: hits.length,
          ...(nextOffset < hits.length
            ? { nextCursor: encodeCursor(nextOffset) }
            : {}),
        },
        undefined,
        offset,
      );
    },

    path(args: {
      from: string;
      to: string;
      edgeKinds?: string[];
      direction?: TraceDirection;
      maxHops?: number;
      limit?: number;
    }) {
      const from = store.indexOf(args.from);
      const to = store.indexOf(args.to);
      if (from === undefined) return errorResult(`Unknown node id: ${args.from}`);
      if (to === undefined) return errorResult(`Unknown node id: ${args.to}`);
      const unknown = unknownKinds(dataset, args.edgeKinds);
      if (unknown.length > 0) {
        return errorResult(`Unknown edge kinds: ${unknown.join(", ")}`, {
          validEdgeKinds: dataset.ontology.edgeKinds.map((k) => k.id),
        });
      }
      const result = store.path(from, to, {
        direction: args.direction ?? "both",
        allowedEdgeKinds: args.edgeKinds,
        maxHops: args.maxHops,
        limit: args.limit,
      });
      return boundResult({
        found: result.paths.length > 0,
        paths: result.paths,
        truncated: result.truncated,
        visited: result.visited,
      });
    },

    aggregate(args: {
      fromId?: string;
      sourceKind?: string;
      targetKind?: string;
      edgeKinds?: string[];
      direction?: TraceDirection;
      groupBy?: "edgeKind" | "sourceKind" | "targetKind" | "neighborKind";
      limit?: number;
    }) {
      let fromIndex: number | undefined;
      if (args.fromId) {
        fromIndex = store.indexOf(args.fromId);
        if (fromIndex === undefined) {
          return errorResult(`Unknown node id: ${args.fromId}`);
        }
      }
      if (unknownNodeKind(dataset, args.sourceKind)) {
        return errorResult(`Unknown node kind: ${args.sourceKind}`, {
          validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
        });
      }
      if (unknownNodeKind(dataset, args.targetKind)) {
        return errorResult(`Unknown node kind: ${args.targetKind}`, {
          validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
        });
      }
      const unknown = unknownKinds(dataset, args.edgeKinds);
      if (unknown.length > 0) {
        return errorResult(`Unknown edge kinds: ${unknown.join(", ")}`, {
          validEdgeKinds: dataset.ontology.edgeKinds.map((k) => k.id),
        });
      }
      return store.aggregate({
        fromIndex,
        direction: args.direction ?? "out",
        edgeKinds: args.edgeKinds,
        sourceKind: args.sourceKind,
        targetKind: args.targetKind,
        groupBy: args.groupBy ?? "edgeKind",
        limit: args.limit ?? 50,
      });
    },
  };
}

export type ArmATools = ReturnType<typeof createArmA>;

export function registerArmA(server: McpServer, dataset: LoadedDataset): void {
  const tools = createArmA(dataset);

  server.registerTool(
    "schema",
    {
      description:
        "Describe the ontology and data: node kinds, edge kinds with allowed source/target kinds and direction, and counts. Call this before traversing.",
      inputSchema: z.object({
        nodeKind: z.string().optional().describe("Only kinds touching this node kind"),
        edgeKind: z.string().optional().describe("Only this edge kind"),
        includeProperties: z.boolean().optional(),
      }),
    },
    async (args) => text(tools.schema(args)),
  );

  server.registerTool(
    "search",
    {
      description:
        "Find nodes by text and/or node kind. Returns compact {id,kind,label}. Paginate with nextCursor.",
      inputSchema: z.object({
        query: z.string().optional().describe("Text to match against id/label"),
        kind: z.string().optional().describe("Restrict to one node kind"),
        limit: z.number().int().optional().describe("Page size (max 100)"),
        cursor: z.string().optional(),
        fields: z.array(z.string()).optional().describe("Optional property fields"),
      }),
    },
    async (args) => text(tools.search(args)),
  );

  server.registerTool(
    "node",
    {
      description:
        "Fetch up to 100 nodes by typed id. Returns compact nodes and a missing-id list.",
      inputSchema: z.object({
        ids: z.array(z.string()).describe("Typed node ids"),
        fields: z.array(z.string()).optional().describe("Optional property fields"),
      }),
    },
    async (args) => text(tools.node(args)),
  );

  server.registerTool(
    "neighbors",
    {
      description:
        "List typed edges incident to a node. Filter by edgeKinds, direction (out/in/both) and neighborKind. Returns {edgeKind,direction,node}. Paginate with nextCursor.",
      inputSchema: z.object({
        id: z.string().describe("Typed node id"),
        edgeKinds: z.array(z.string()).optional().describe("Allowed edge kinds"),
        direction: directionSchema.optional().describe("Default both"),
        neighborKind: z.string().optional().describe("Only this neighbor node kind"),
        limit: z.number().int().optional().describe("Page size (max 100)"),
        cursor: z.string().optional(),
        fields: z.array(z.string()).optional(),
      }),
    },
    async (args) => text(tools.neighbors(args)),
  );

  server.registerTool(
    "path",
    {
      description:
        "Find up to N shortest paths between two typed node ids under hop and edge-kind bounds. direction=both treats edges as undirected. Returns node ids and edge kinds per path.",
      inputSchema: z.object({
        from: z.string().describe("Start node id"),
        to: z.string().describe("End node id"),
        edgeKinds: z.array(z.string()).optional().describe("Allowed edge kinds"),
        direction: directionSchema.optional().describe("Default both"),
        maxHops: z.number().int().optional().describe("Default 4, max 6"),
        limit: z.number().int().optional().describe("Max paths, default 5"),
      }),
    },
    async (args) => text(tools.path(args)),
  );

  server.registerTool(
    "aggregate",
    {
      description:
        "Count edges matching typed filters. Optionally start from one node (fromId) and group by edgeKind, sourceKind, targetKind, or neighborKind. Returns total and groups.",
      inputSchema: z.object({
        fromId: z.string().optional(),
        sourceKind: z.string().optional(),
        targetKind: z.string().optional(),
        edgeKinds: z.array(z.string()).optional(),
        direction: directionSchema.optional().describe("Used with fromId; default out"),
        groupBy: z
          .enum(["edgeKind", "sourceKind", "targetKind", "neighborKind"])
          .optional(),
        limit: z.number().int().optional(),
      }),
    },
    async (args) => text(tools.aggregate(args)),
  );
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
