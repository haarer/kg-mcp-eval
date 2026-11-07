import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KuzuDataset } from "../kuzu.js";
import { runCypher } from "../kuzu.js";
import { schemaFromOntology } from "./common.js";

export function createArmB(runtime: KuzuDataset) {
  const baseSchema = (args: {
    nodeKind?: string;
    edgeKind?: string;
    includeProperties?: boolean;
  }) => {
    const schema = schemaFromOntology(
      runtime.ontology,
      {
        nodes: runtime.ontology.counts?.nodeKinds ?? {},
        edges: runtime.ontology.counts?.edgeKinds ?? {},
      },
      {
        nodes: runtime.ontology.counts?.nodes ?? 0,
        edges: runtime.ontology.counts?.edges ?? 0,
        loadMs: runtime.loadMs,
      },
      args,
    );
    return {
      ...schema,
      graphModel: {
        nodeTable: "Node",
        nodeProperties: ["id", "kind", "label"],
        relationshipTables:
          "Every edge kind has one relationship table named cypherTable. All relationships connect Node to Node.",
      },
      edgeKinds: schema.edgeKinds.map((kind) => ({
        ...kind,
        cypherTable: runtime.edgeTableByKind.get(kind.id as string),
      })),
    };
  };

  return {
    schema: baseSchema,
    async cypher(args: {
      query: string;
      params?: Record<string, unknown>;
      limit?: number;
    }) {
      try {
        return await runCypher(runtime, args.query, {
          params: args.params,
          limit: args.limit,
        });
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          hint: "Read-only queries only. Use schema to discover node kinds and relationship table names.",
        };
      }
    },
  };
}

export type ArmBTools = ReturnType<typeof createArmB>;

export function registerArmB(server: McpServer, runtime: KuzuDataset): void {
  const tools = createArmB(runtime);

  server.registerTool(
    "schema",
    {
      description:
        "Describe the ontology and the Cypher graph model: node kinds, edge kinds with cypherTable names, endpoints, direction, and counts. Call this before writing Cypher.",
      inputSchema: z.object({
        nodeKind: z.string().optional(),
        edgeKind: z.string().optional(),
        includeProperties: z.boolean().optional(),
      }),
    },
    async (args) => text(tools.schema(args)),
  );

  server.registerTool(
    "cypher",
    {
      description:
        "Run a read-only Cypher query against the graph. Node(id, kind, label); each edge kind has a relationship table named cypherTable (FROM Node TO Node). MATCH/WITH/RETURN/UNWIND/WHERE/ORDER BY/LIMIT are allowed; mutations are rejected. Returns columns and rows.",
      inputSchema: z.object({
        query: z.string().describe("Read-only Cypher query"),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional query parameters"),
        limit: z.number().int().optional().describe("Row cap, default 100"),
      }),
    },
    async (args) => text(await tools.cypher(args)),
  );
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
