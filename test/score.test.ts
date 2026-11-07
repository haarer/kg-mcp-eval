import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/graph/load.js";
import { scoreTask } from "../src/bench/score.js";
import type { Task } from "../src/bench/generate.js";

test("independent scorer handles ids, sets, booleans, and paths", async () => {
  const dataset = await loadDataset("se-seed");

  const idSet: Task = {
    id: "test-id-set",
    dataset: "se-seed",
    category: "se_composition",
    prompt: "",
    answer_type: "id_set",
    gold: ["C-ACT", "C-FCC"],
  };
  assert.equal(scoreTask(idSet, ["C-FCC", "C-ACT"], dataset).correct, true);
  assert.equal(scoreTask(idSet, ["C-ACT"], dataset).correct, false);
  assert.equal(scoreTask(idSet, "C-ACT, C-FCC", dataset).correct, false);

  const kindSet: Task = {
    id: "test-kind-set",
    dataset: "se-seed",
    category: "se_hierarchy",
    prompt: "",
    answer_type: "kind_set",
    gold: ["HardwareComponent", "SoftwareComponent"],
  };
  assert.equal(
    scoreTask(
      kindSet,
      ["SoftwareComponent", "HardwareComponent"],
      dataset,
    ).correct,
    true,
  );

  const booleanTask: Task = {
    id: "test-boolean",
    dataset: "se-seed",
    category: "negative",
    prompt: "",
    answer_type: "boolean",
    gold: false,
  };
  assert.equal(scoreTask(booleanTask, false, dataset).correct, true);
  assert.equal(scoreTask(booleanTask, "false", dataset).correct, true);
  assert.equal(scoreTask(booleanTask, true, dataset).correct, false);

  const pathTask: Task = {
    id: "test-path",
    dataset: "se-seed",
    category: "se_trace",
    prompt: "",
    answer_type: "path",
    constraints: {
      from: "R-003",
      to: "T-003",
      maxHops: 1,
      edgeKinds: ["verifies"],
      direction: "both",
    },
    gold: { from: "R-003", to: "T-003", maxHops: 1, direction: "both" },
  };
  assert.equal(
    scoreTask(pathTask, { nodes: ["R-003", "T-003"], edges: ["verifies"] }, dataset)
      .correct,
    true,
  );
  assert.equal(
    scoreTask(pathTask, { nodes: ["R-003", "T-002"], edges: ["verifies"] }, dataset)
      .correct,
    false,
  );
});
