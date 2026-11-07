import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/graph/load.js";
import { createArmA } from "../src/server/tools/a.js";
import { createArmC } from "../src/server/tools/c.js";

test("arm A typed tools over the SE seed", async () => {
  const dataset = await loadDataset("se-seed");
  const tools = createArmA(dataset);

  const schema = tools.schema({}) as {
    nodeKinds: { id: string; parent?: string }[];
    edgeKinds: { id: string }[];
  };
  assert.ok(schema.nodeKinds.some((kind) => kind.id === "SoftwareComponent"));
  assert.ok(schema.edgeKinds.some((kind) => kind.id === "satisfies"));

  const search = tools.search({
    query: "Flight Control",
    kind: "SoftwareComponent",
  }) as { items: { id: string }[]; total: number };
  assert.deepEqual(search.items.map((item) => item.id), ["C-FCC"]);
  assert.equal(search.total, 1);

  const neighbors = tools.neighbors({
    id: "C-FCC",
    edgeKinds: ["satisfies"],
    direction: "out",
  }) as { items: unknown[]; total: number };
  assert.equal(neighbors.total, 3);

  const path = tools.path({
    from: "C-FCC",
    to: "T-001",
    edgeKinds: ["satisfies", "verifies"],
    maxHops: 2,
  }) as { found: boolean; paths: { nodes: string[] }[] };
  assert.equal(path.found, true);
  assert.deepEqual(path.paths[0]!.nodes, ["C-FCC", "R-001", "T-001"]);

  const aggregate = tools.aggregate({
    fromId: "SYS-FCS",
    edgeKinds: ["contains"],
    direction: "out",
  }) as { total: number };
  assert.equal(aggregate.total, 6);

  const unknown = tools.neighbors({
    id: "C-FCC",
    edgeKinds: ["bogus"],
  }) as unknown as { error?: string; validEdgeKinds?: string[] };
  assert.match(unknown.error ?? "", /Unknown edge kinds/);
  assert.ok(unknown.validEdgeKinds?.includes("satisfies"));
});

test("arm C dump is bounded and paginates", async () => {
  const dataset = await loadDataset("se-seed");
  const tools = createArmC(dataset);
  const first = tools.dump({
    what: "nodes",
    kind: "TestCase",
    limit: 3,
  }) as unknown as {
    items: { id: string }[];
    total: number;
    nextCursor?: string;
  };
  assert.equal(first.total, 6);
  assert.equal(first.items.length, 3);
  assert.ok(first.nextCursor);
  const second = tools.dump({
    what: "nodes",
    kind: "TestCase",
    limit: 3,
    cursor: first.nextCursor,
  }) as unknown as { items: { id: string }[]; nextCursor?: string };
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, undefined);
});

test("byte-bounded pages advance the cursor by the returned count", async () => {
  const { boundResult, decodeCursor } = await import(
    "../src/server/tools/common.js"
  );
  const result = boundResult(
    {
      items: Array.from({ length: 1000 }, (_, i) => ({ id: `x${"y".repeat(60)}${i}` })),
      total: 5000,
      nextCursor: "stale",
    },
    undefined,
    100,
  ) as unknown as {
    items: unknown[];
    total: number;
    nextCursor?: string;
    truncated?: boolean;
  };
  assert.equal(result.truncated, true);
  assert.ok(result.items.length < 1000);
  assert.equal(decodeCursor(result.nextCursor), 100 + result.items.length);
});
