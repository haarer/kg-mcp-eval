import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LoadedDataset } from "../../graph/load.js";
import {
  boundResult,
  compactNode,
  decodeCursor,
  encodeCursor,
  errorResult,
  schemaResult,
} from "./common.js";

const DUMP_LIMIT = 200;
const DUMP_HARD_LIMIT = 1000;

export function createArmC(dataset: LoadedDataset) {
  const { store } = dataset;

  return {
    schema(args: { nodeKind?: string; edgeKind?: string }) {
      return schemaResult(dataset, args);
    },

    dump(args: {
      what: "nodes" | "edges";
      kind?: string;
      edgeKind?: string;
      limit?: number;
      cursor?: string;
    }) {
      const limit = Math.max(
        1,
        Math.min(Math.floor(args.limit ?? DUMP_LIMIT), DUMP_HARD_LIMIT),
      );
      const offset = decodeCursor(args.cursor);

      if (args.what === "nodes") {
        if (args.kind && !dataset.index.nodeKindById.has(args.kind)) {
          return errorResult(`Unknown node kind: ${args.kind}`, {
            validNodeKinds: dataset.ontology.nodeKinds.map((k) => k.id),
          });
        }
        const all = args.kind
          ? (store.nodesByKind.get(args.kind) ?? [])
          : store.nodes.map((_, i) => i);
        const page = all.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        return boundResult(
          {
            items: page.map((i) => compactNode(store.nodeAt(i))),
            total: all.length,
            ...(nextOffset < all.length
              ? { nextCursor: encodeCursor(nextOffset) }
              : {}),
          },
          undefined,
          offset,
        );
      }

      if (args.edgeKind && !dataset.index.edgeKindById.has(args.edgeKind)) {
        return errorResult(`Unknown edge kind: ${args.edgeKind}`, {
          validEdgeKinds: dataset.ontology.edgeKinds.map((k) => k.id),
        });
      }
      const items: {
        source: string;
        target: string;
        kind: string;
      }[] = [];
      let matched = 0;
      for (let e = 0; e < store.edgeKind.length; e += 1) {
        const kind = store.edgeKindAt(e);
        if (args.edgeKind && kind !== args.edgeKind) continue;
        matched += 1;
        if (matched <= offset) continue;
        if (items.length >= limit) continue;
        items.push({
          source: store.nodeAt(store.edgeSource[e]!).id,
          target: store.nodeAt(store.edgeTarget[e]!).id,
          kind,
        });
      }
      const nextOffset = offset + items.length;
      return boundResult(
        {
          items,
          total: matched,
          ...(nextOffset < matched
            ? { nextCursor: encodeCursor(nextOffset) }
            : {}),
        },
        undefined,
        offset,
      );
    },
  };
}

export type ArmCTools = ReturnType<typeof createArmC>;

export function registerArmC(server: McpServer, dataset: LoadedDataset): void {
  const tools = createArmC(dataset);

  server.registerTool(
    "schema",
    {
      description:
        "Describe the ontology and data: node kinds, edge kinds, endpoints, direction, and counts.",
      inputSchema: z.object({
        nodeKind: z.string().optional(),
        edgeKind: z.string().optional(),
      }),
    },
    async (args) => text(tools.schema(args)),
  );

  server.registerTool(
    "dump",
    {
      description:
        "Return a bounded raw slice of nodes or edges. Paginate with nextCursor. This is intentionally verbose and unbounded in shape, capped by bytes.",
      inputSchema: z.object({
        what: z.enum(["nodes", "edges"]),
        kind: z.string().optional().describe("Node kind when what=nodes"),
        edgeKind: z.string().optional().describe("Edge kind when what=edges"),
        limit: z.number().int().optional().describe("Default 200, max 1000"),
        cursor: z.string().optional(),
      }),
    },
    async (args) => text(tools.dump(args)),
  );
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
