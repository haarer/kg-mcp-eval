import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/graph/load.js";

test("SE graph search, traversal, aggregation, and path validation", async () => {
  const { store } = await loadDataset("se-seed");
  assert.equal(store.nodeCount, 31);
  assert.equal(store.edgeCount, 39);

  const search = store.search("Flight Control", { limit: 10, offset: 0 });
  assert.deepEqual(
    search.hits.map((i) => store.nodeAt(i).id),
    ["C-FCC", "SYS-FCS"],
  );

  const contained = store.neighbors(store.indexOf("SYS-FCS")!, {
    direction: "out",
    edgeKinds: ["contains"],
  });
  assert.deepEqual(
    contained.map((hit) => store.nodeAt(hit.nodeIndex).id).sort(),
    ["C-ACT", "C-FCC", "C-NAV", "C-PDU", "C-SFM", "C-TLM"],
  );

  const aggregate = store.aggregate({
    fromIndex: store.indexOf("SYS-FCS")!,
    direction: "out",
    edgeKinds: ["contains"],
    groupBy: "edgeKind",
    limit: 5,
  });
  assert.equal(aggregate.total, 6);

  const path = store.path(
    store.indexOf("C-FCC")!,
    store.indexOf("T-001")!,
    {
      direction: "both",
      allowedEdgeKinds: ["satisfies", "verifies"],
      maxHops: 2,
      limit: 1,
    },
  );
  assert.equal(path.paths.length, 1);
  assert.deepEqual(path.paths[0]!.nodes, ["C-FCC", "R-001", "T-001"]);
  assert.deepEqual(path.paths[0]!.edges, ["satisfies", "verifies"]);
  assert.equal(
    store.isValidPath(path.paths[0]!.nodes, path.paths[0]!.edges, {
      from: "C-FCC",
      to: "T-001",
      maxHops: 2,
      allowedEdgeKinds: ["satisfies", "verifies"],
      direction: "both",
    }),
    true,
  );
  assert.equal(
    store.isValidPath(
      ["C-FCC", "T-001"],
      ["verifies"],
      { from: "C-FCC", to: "T-001", maxHops: 1, direction: "both" },
    ),
    false,
  );
});
