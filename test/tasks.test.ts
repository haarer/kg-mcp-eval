import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  generateAllTasks,
  type Task,
  type TaskManifest,
} from "../src/bench/generate.js";
import { validateTasks } from "../src/bench/validate.js";
import { loadDataset } from "../src/graph/load.js";

const TASK_DIR = path.resolve(process.cwd(), "bench", "tasks");

function parseJsonl(text: string): Task[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Task);
}

test("committed task suite is deterministic, complete, and oracle-valid", async () => {
  const hetionet = await loadDataset("hetionet");
  const seSeed = await loadDataset("se-seed");
  const datasets = { hetionet, "se-seed": seSeed };

  const storedTasks = parseJsonl(
    await readFile(path.join(TASK_DIR, "tasks.jsonl"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(path.join(TASK_DIR, "manifest.json"), "utf8"),
  ) as TaskManifest;

  assert.equal(storedTasks.length, 44);
  assert.equal(manifest.tasks, 44);
  assert.deepEqual(manifest.byDataset, { hetionet: 38, "se-seed": 6 });
  validateTasks(storedTasks, datasets);

  const regenerated = generateAllTasks(hetionet, seSeed, manifest.seed);
  assert.equal(regenerated.tasks.length, 44);
  assert.deepEqual(regenerated.tasks, storedTasks);
});
