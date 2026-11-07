import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = path.join(ROOT, "bench", "calibration");
const MODEL_FILE = path.join(ROOT, "bench", "model.json");

const DEFAULT_TASKS = [
  "het-lookup-01",
  "het-onehop-01",
  "het-multihop-01",
  "het-aggregate-01",
  "het-path-01",
  "het-negative-01",
  "se-hierarchy-01",
  "se-composition-01",
].join(",");

const DEFAULT_MODELS = [
  "opencode/flint-40b-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/beam-free",
  "opencode/glm-5.3-flash-free",
];

interface Summary {
  aborted?: string;
  attempts: {
    correct: boolean;
    tokens: { total: number };
    toolCalls: number;
    latencyMs: number;
  }[];
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeName(model: string): string {
  return model.replace(/[^A-Za-z0-9_.-]/g, "_");
}

async function runModel(model: string, tasks: string): Promise<{
  model: string;
  aborted?: string;
  attempts: number;
  correct: number;
  accuracy: number;
  tokens: number;
  toolCalls: number;
  latencyMs: number;
  outDir: string;
}> {
  const outDir = path.join(OUT, safeName(model));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "bench/harness/run.ts"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          KG_MODEL: model,
          KG_ARMS: "a",
          KG_REPS: "1",
          KG_TASKS: tasks,
          KG_OUT: outDir,
          KG_TIMEOUT_MS: process.env.KG_TIMEOUT_MS ?? "120000",
        },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  const summary = JSON.parse(
    await readFile(path.join(outDir, "summary.json"), "utf8"),
  ) as Summary;
  const valid = summary.attempts.filter((attempt) => attempt.tokens.total > 0);
  const correct = summary.attempts.filter((attempt) => attempt.correct).length;
  const mean = (values: number[]) =>
    values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    model,
    aborted: summary.aborted,
    attempts: summary.attempts.length,
    correct,
    accuracy: summary.attempts.length === 0 ? 0 : correct / summary.attempts.length,
    tokens: mean(valid.map((attempt) => attempt.tokens.total)),
    toolCalls: mean(valid.map((attempt) => attempt.toolCalls)),
    latencyMs: mean(valid.map((attempt) => attempt.latencyMs)),
    outDir,
  };
}

async function main(): Promise<void> {
  const models = parseList(process.env.KG_MODELS, DEFAULT_MODELS);
  const tasks = process.env.KG_CALIBRATION_TASKS ?? DEFAULT_TASKS;
  await mkdir(OUT, { recursive: true });
  const results = [];
  for (const model of models) {
    console.log(`\n=== calibrating ${model} ===`);
    try {
      results.push(await runModel(model, tasks));
    } catch (error) {
      results.push({
        model,
        aborted: error instanceof Error ? error.message : String(error),
        attempts: 0,
        correct: 0,
        accuracy: 0,
        tokens: 0,
        toolCalls: 0,
        latencyMs: 0,
        outDir: "",
      });
    }
  }

  const viable = results.filter(
    (result) => !result.aborted && result.attempts > 0 && result.correct > 0,
  );
  viable.sort(
    (a, b) => b.accuracy - a.accuracy || a.tokens - b.tokens || a.latencyMs - b.latencyMs,
  );
  const chosen = viable[0];
  const payload = {
    calibratedAt: new Date().toISOString(),
    tasks: tasks.split(","),
    candidates: results,
    chosen: chosen?.model ?? null,
  };
  await writeFile(
    path.join(OUT, "calibration.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
  if (chosen) {
    await writeFile(
      MODEL_FILE,
      JSON.stringify(
        {
          model: chosen.model,
          calibratedAt: payload.calibratedAt,
          calibrationTasks: payload.tasks,
          accuracy: chosen.accuracy,
          tokens: chosen.tokens,
          toolCalls: chosen.toolCalls,
          latencyMs: chosen.latencyMs,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    console.log(`\nchosen model: ${chosen.model}`);
  } else {
    console.log("\nno viable model; see bench/calibration/calibration.json");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
