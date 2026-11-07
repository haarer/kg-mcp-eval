import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateAllTasks } from "../src/bench/generate.js";
import { validateTasks } from "../src/bench/validate.js";
import { loadDataset } from "../src/graph/load.js";

const OUT_DIR = path.resolve(process.cwd(), "bench", "tasks");

function parseSeed(argv: string[]): number {
  const index = argv.indexOf("--seed");
  if (index === -1) return 20261107;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value)) throw new Error("--seed must be an integer");
  return value;
}

async function main(): Promise<void> {
  const seed = parseSeed(process.argv.slice(2));
  const hetionet = await loadDataset("hetionet");
  const seSeed = await loadDataset("se-seed");
  const { tasks, manifest } = generateAllTasks(hetionet, seSeed, seed);

  validateTasks(tasks, { hetionet, "se-seed": seSeed });
  if (tasks.length !== 44) {
    throw new Error(`Expected 44 tasks, got ${tasks.length}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const jsonl = tasks.map((task) => JSON.stringify(task)).join("\n") + "\n";
  await writeFile(path.join(OUT_DIR, "tasks.jsonl"), jsonl, "utf8");
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  console.log(`Wrote ${tasks.length} tasks to ${OUT_DIR}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
