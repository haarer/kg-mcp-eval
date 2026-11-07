import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadKuzuDataset } from "../src/server/kuzu.js";
import { createArmB } from "../src/server/tools/b.js";

test("arm B exposes Cypher tables and rejects mutations", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "kg-mcp-kuzu-"));
  try {
    const runtime = await loadKuzuDataset("se-seed", { cacheDir });
    const tools = createArmB(runtime);
    const schema = tools.schema({}) as unknown as {
      edgeKinds: { id: string; cypherTable?: string }[];
      graphModel: { nodeTable: string };
    };
    assert.equal(schema.graphModel.nodeTable, "Node");
    const contains = schema.edgeKinds.find((kind) => kind.id === "contains");
    assert.equal(contains?.cypherTable, "contains");

    const query = await tools.cypher({
      query:
        "MATCH (s:Node {id:'SYS-FCS'})-[r:contains]->(c:Node) RETURN c.id AS id ORDER BY id",
    });
    assert.deepEqual(query, {
      columns: ["id"],
      rows: [
        { id: "C-ACT" },
        { id: "C-FCC" },
        { id: "C-NAV" },
        { id: "C-PDU" },
        { id: "C-SFM" },
        { id: "C-TLM" },
      ],
      rowCount: 6,
      truncated: false,
    });

    const params = await tools.cypher({
      query: "MATCH (n:Node) WHERE n.id = $id RETURN n.label AS label",
      params: { id: "C-FCC" },
    });
    assert.deepEqual(
      (params as unknown as { rows: unknown[] }).rows,
      [{ label: "Flight Control Computer" }],
    );

    const mutation = (await tools.cypher({
      query: "CREATE (n:Node {id:'x'})",
    })) as unknown as { error?: string };
    assert.match(mutation.error ?? "", /not allowed/);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("Kuzu COPY handles commas in node labels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kg-mcp-kuzu-csv-"));
  try {
    const dataDir = path.join(root, "data", "se-seed");
    await mkdir(dataDir, { recursive: true });
    const graph = JSON.parse(
      await readFile(path.join("data", "normalized", "se-seed", "graph.json"), "utf8"),
    ) as { nodes: { id: string; label: string }[] };
    graph.nodes[0]!.label = "Flight Control, Computer";
    await writeFile(path.join(dataDir, "graph.json"), JSON.stringify(graph));

    const runtime = await loadKuzuDataset("se-seed", {
      dataDir: path.join(root, "data"),
      cacheDir: path.join(root, "cache"),
    });
    const tools = createArmB(runtime);
    const result = (await tools.cypher({
      query: "MATCH (n:Node) WHERE n.id = $id RETURN n.label AS label",
      params: { id: graph.nodes[0]!.id },
    })) as unknown as { rows: { label: string }[] };
    assert.equal(result.rows[0]?.label, "Flight Control, Computer");
    await runtime.db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
