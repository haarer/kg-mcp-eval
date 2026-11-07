import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDataset,
  type DatasetName,
  type LoadedDataset,
} from "../../src/graph/load.js";
import { scoreTask } from "../../src/bench/score.js";
import { extractAnswer } from "./answer.js";
import type { Task } from "../../src/bench/generate.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TASK_FILE = path.join(ROOT, "bench", "tasks", "tasks.jsonl");
const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode";
const FATAL_PATTERNS = [
  "Free usage limit reached",
  "Insufficient account funds",
  "Model access is disabled",
  "This model is not available in your country",
];

type Arm = "a" | "b" | "c";

interface Config {
  runId: string;
  model: string;
  arms: Arm[];
  reps: number;
  timeoutMs: number;
  maxToolCalls: number;
  maxTurns: number;
  portBase: number;
  smoke: boolean;
  taskFilter?: Set<string>;
  taskLimit?: number;
  outDir: string;
}

type AttemptStatus =
  | "correct"
  | "wrong_answer"
  | "invalid_format"
  | "timeout"
  | "tool_limit"
  | "turn_limit"
  | "error";

interface Attempt {
  runId: string;
  model: string;
  arm: Arm;
  dataset: DatasetName;
  taskId: string;
  category: string;
  answerType: string;
  rep: number;
  correct: boolean;
  status: AttemptStatus;
  statusReason: string;
  scoreReason: string;
  answer?: unknown;
  answerError?: string;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  toolCalls: number;
  toolNames: string[];
  turns: number;
  latencyMs: number;
  timedOut: boolean;
  toolLimitExceeded: boolean;
  turnLimitExceeded: boolean;
  error?: string;
  fatal?: string;
  sessionId?: string;
}

interface Aggregate {
  n: number;
  invalid: number;
  correct: number;
  accuracy: number;
  tokens: number;
  toolCalls: number;
  turns: number;
  latencyMs: number;
  tokenCi?: [number, number];
  toolCi?: [number, number];
  accuracyCi?: [number, number];
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pinnedModel(): string | undefined {
  try {
    const value = JSON.parse(
      readFileSync(path.join(ROOT, "bench", "model.json"), "utf8"),
    ) as { model?: unknown };
    return typeof value.model === "string" ? value.model : undefined;
  } catch {
    return undefined;
  }
}

function loadConfig(): Config {
  const arms = parseList(process.env.KG_ARMS, ["a", "b", "c"]) as Arm[];
  for (const arm of arms) {
    if (!["a", "b", "c"].includes(arm)) throw new Error(`Invalid arm: ${arm}`);
  }
  const smoke = process.argv.includes("--smoke");
  const runId = process.env.KG_RUN_ID ?? `run-${timestamp()}`;
  const outDir =
    process.env.KG_OUT ?? path.join(ROOT, "bench", "results", runId);
  const taskIds = parseList(process.env.KG_TASKS, []);
  const taskLimitValue = process.env.KG_TASK_LIMIT
    ? Number(process.env.KG_TASK_LIMIT)
    : undefined;
  return {
    runId,
    model:
      process.env.KG_MODEL ??
      pinnedModel() ??
      "opencode/deepseek-v4.1-flash-free",
    arms,
    reps: Number(process.env.KG_REPS ?? (smoke ? 1 : 3)),
    timeoutMs: Number(process.env.KG_TIMEOUT_MS ?? 300_000),
    maxToolCalls: Number(process.env.KG_MAX_TOOL_CALLS ?? 25),
    maxTurns: Number(process.env.KG_MAX_TURNS ?? 15),
    portBase: Number(process.env.KG_PORT_BASE ?? 8810),
    smoke,
    taskFilter: taskIds.length > 0 ? new Set(taskIds) : undefined,
    taskLimit:
      taskLimitValue !== undefined && Number.isInteger(taskLimitValue)
        ? taskLimitValue
        : undefined,
    outDir,
  };
}

async function readTasks(): Promise<Task[]> {
  const text = await readFile(TASK_FILE, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Task);
}

function selectedTasks(tasks: Task[], config: Config): Task[] {
  let selected = config.taskFilter
    ? tasks.filter((task) => config.taskFilter!.has(task.id))
    : tasks;
  if (config.smoke) {
    const seen = new Set<string>();
    selected = selected.filter((task) => {
      const key = `${task.dataset}:${task.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (config.taskLimit !== undefined) selected = selected.slice(0, config.taskLimit);
  return selected;
}

async function loadScoringDatasets(
  tasks: Task[],
): Promise<Map<DatasetName, LoadedDataset>> {
  const names = new Set(tasks.map((task) => task.dataset));
  const datasets = new Map<DatasetName, LoadedDataset>();
  for (const name of names) datasets.set(name, await loadDataset(name));
  return datasets;
}

function globalMcpNames(): string[] {
  try {
    const file = path.join(os.homedir(), ".config", "opencode", "opencode.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      mcp?: Record<string, unknown>;
    };
    return Object.keys(config.mcp ?? {});
  } catch {
    return [];
  }
}

interface ServerHandle {
  key: string;
  arm: Arm;
  dataset: DatasetName;
  port: number;
  process: ChildProcess;
  logPath: string;
}

function serverKey(arm: Arm, dataset: DatasetName): string {
  return `${arm}-${dataset}`;
}

async function startServer(
  arm: Arm,
  dataset: DatasetName,
  port: number,
  config: Config,
): Promise<ServerHandle> {
  const serverDir = path.join(config.outDir, "servers");
  await mkdir(serverDir, { recursive: true });
  const logPath = path.join(serverDir, `${serverKey(arm, dataset)}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/http.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        KG_ARM: arm,
        KG_DATASET: dataset,
        KG_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  const healthUrl = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + (arm === "b" && dataset === "hetionet" ? 900_000 : 120_000);
  for (;;) {
    if (child.exitCode !== null) {
      const text = await readFile(logPath, "utf8").catch(() => "");
      throw new Error(`Server ${arm}/${dataset} exited early:\n${text.slice(-2000)}`);
    }
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) break;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Server ${arm}/${dataset} did not become healthy`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { key: serverKey(arm, dataset), arm, dataset, port, process: child, logPath };
}

function sealedPrompt(): string {
  return [
    "You are a sealed knowledge-graph benchmark agent.",
    "You can use only the kg MCP server tools (tool names begin with kg_).",
    "The filesystem, shell, web, and all other tools are disabled.",
    "Use the available kg tools to answer the question. Do not guess when a tool can check.",
    "",
    "When you are finished, your final message must be exactly one JSON object and no prose:",
    '{"answer": <value>}',
    "Choose the shape of <value> to match the question:",
    "- A list of things: a JSON array of node IDs, e.g. {\"answer\": [\"Gene::1001\"]}.",
    "- A count: a bare number, e.g. {\"answer\": 4}.",
    "- A yes/no question: a bare true or false, e.g. {\"answer\": false}.",
    "- A path (a sequence of hops): an object with the ordered node IDs and the edge kind used on each hop, e.g.",
    '  {"answer": {"nodes": ["Gene::1001", "Biological Process::GO:0001001", "Compound::DB00001"], "edges": ["GpBP", "CpD"]}}',
    "  where nodes[0] is the start node, the last node is the end node, and edges[i] is the kind of the edge from nodes[i] to nodes[i+1]. Both arrays must be present and edges must have exactly one fewer entry than nodes.",
    "- A path-existence question: an object with an exists boolean, plus the same nodes/edges path when exists is true, e.g.",
    '  {"answer": {"exists": true, "nodes": ["Gene::1001", "Compound::DB00001"], "edges": ["CpD"]}}',
    '  or, when no such path exists, exactly {"answer": {"exists": false}}.',
    "",
    "Before you finish, call the kg_validate_answer tool with the EXACT JSON string you intend to output as your final message. If it returns valid:false, revise your answer until it returns valid:true, then emit that JSON as your final message with no other text.",
  ].join("\n");
}

async function writeOpencodeConfig(
  server: ServerHandle,
  config: Config,
): Promise<string> {
  const dir = path.join(config.outDir, "configs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${server.key}.json`);
  const disabledMcp = Object.fromEntries(
    globalMcpNames().map((name) => [name, { enabled: false }]),
  );
  const value = {
    $schema: "https://opencode.ai/config.json",
    model: config.model,
    small_model: config.model,
    lsp: false,
    formatter: false,
    snapshot: false,
    compaction: { auto: false },
    mcp: {
      ...disabledMcp,
      kg: {
        type: "remote",
        url: `http://127.0.0.1:${server.port}/mcp`,
        enabled: true,
        timeout: 30_000,
      },
    },
    permission: {
      read: "deny",
      edit: "deny",
      glob: "deny",
      grep: "deny",
      list: "deny",
      bash: "deny",
      task: "deny",
      todowrite: "deny",
      question: "deny",
      webfetch: "deny",
      websearch: "deny",
      lsp: "deny",
      skill: "deny",
      external_directory: "deny",
    },
    agent: {
      title: { disable: true },
      "kg-sealed": {
        mode: "primary",
        model: config.model,
        steps: config.maxTurns,
        temperature: 0,
        description: "Sealed KG benchmark agent.",
        prompt: sealedPrompt(),
        tools: {
          bash: false,
          edit: false,
          write: false,
          read: false,
          grep: false,
          glob: false,
          list: false,
          task: false,
          todowrite: false,
          webfetch: false,
          websearch: false,
          patch: false,
          skill: false,
          question: false,
        },
      },
    },
  };
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  return file;
}

interface ParsedOutput {
  texts: string[];
  tokens: Attempt["tokens"];
  toolCalls: number;
  toolNames: string[];
  turns: number;
  sessionId?: string;
  fatal?: string;
}

function emptyTokens(): Attempt["tokens"] {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
}

function isToolEvent(event: Record<string, unknown>): boolean {
  const type = String(event.type ?? "");
  const part = event.part as Record<string, unknown> | undefined;
  const partType = String(part?.type ?? "");
  return (
    type === "tool" ||
    type === "tool_use" ||
    partType === "tool" ||
    partType === "tool-use" ||
    partType === "tool_use"
  );
}

function consumeEvent(
  event: Record<string, unknown>,
  output: ParsedOutput,
  toolIds: Set<string>,
): void {
  const sessionId = event.sessionID as string | undefined;
  if (!output.sessionId && sessionId) output.sessionId = sessionId;
  if (sessionId && output.sessionId && sessionId !== output.sessionId) return;

  const type = String(event.type ?? "");
  const part = event.part as Record<string, unknown> | undefined;

  if (type === "text") {
    const text = part?.text;
    if (typeof text === "string") output.texts.push(text);
  } else if (type === "step_finish") {
    output.turns += 1;
    const tokens = part?.tokens as
      | {
          input?: number;
          output?: number;
          reasoning?: number;
          total?: number;
          cache?: { read?: number; write?: number };
        }
      | undefined;
    if (tokens) {
      const input = Number(tokens.input ?? 0);
      const out = Number(tokens.output ?? 0);
      const reasoning = Number(tokens.reasoning ?? 0);
      const cacheRead = Number(tokens.cache?.read ?? 0);
      const cacheWrite = Number(tokens.cache?.write ?? 0);
      output.tokens.input += input;
      output.tokens.output += out;
      output.tokens.reasoning += reasoning;
      output.tokens.cacheRead += cacheRead;
      output.tokens.cacheWrite += cacheWrite;
      output.tokens.total += Number(
        tokens.total ?? input + out + reasoning + cacheRead + cacheWrite,
      );
    }
  } else if (isToolEvent(event)) {
    const id =
      String(part?.id ?? "") ||
      String(part?.toolCallId ?? "") ||
      `${type}-${output.toolCalls}`;
    if (!toolIds.has(id)) {
      toolIds.add(id);
      output.toolCalls += 1;
      const name = part?.tool ?? part?.name ?? part?.title;
      if (typeof name === "string") output.toolNames.push(name);
    }
  } else if (type === "error") {
    const error = event.error as Record<string, unknown> | undefined;
    const data = error?.data as Record<string, unknown> | undefined;
    const message =
      String(data?.message ?? error?.name ?? error?.message ?? "") ||
      JSON.stringify(event.error ?? {});
    if (FATAL_PATTERNS.some((pattern) => message.includes(pattern))) {
      output.fatal = message;
    }
  }
}

async function runAttempt(options: {
  config: Config;
  task: Task;
  rep: number;
  arm: Arm;
  server: ServerHandle;
  opencodeConfig: string;
  dataset: LoadedDataset;
}): Promise<Attempt> {
  const { config, task, rep, arm, server, opencodeConfig, dataset } = options;
  const workdir = await mkdtemp(path.join(os.tmpdir(), "kg-mcp-task-"));
  const started = Date.now();
  const output: ParsedOutput = {
    texts: [],
    tokens: emptyTokens(),
    toolCalls: 0,
    toolNames: [],
    turns: 0,
  };
  const toolIds = new Set<string>();
  let timedOut = false;
  let toolLimitExceeded = false;
  let turnLimitExceeded = false;
  let stderr = "";

  const child = spawn(
    OPENCODE_BIN,
    [
      "run",
      "--format",
      "json",
      "--print-logs",
      "--log-level",
      "ERROR",
      "--pure",
      "--agent",
      "kg-sealed",
      "--dir",
      workdir,
      task.prompt,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        OPENCODE_CONFIG: opencodeConfig,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      consumeEvent(event, output, toolIds);
      if (output.toolCalls > config.maxToolCalls) {
        toolLimitExceeded = true;
        child.kill("SIGKILL");
      }
      if (output.turns > config.maxTurns) {
        turnLimitExceeded = true;
        child.kill("SIGKILL");
      }
    } catch {
      // ignore non-JSON output
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (FATAL_PATTERNS.some((pattern) => stderr.includes(pattern))) {
      output.fatal = FATAL_PATTERNS.find((pattern) =>
        stderr.includes(pattern),
      );
      child.kill("SIGKILL");
    }
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, config.timeoutMs);

  await new Promise<void>((resolve) => {
    child.on("close", () => resolve());
    child.on("error", (error) => {
      output.fatal = error.message;
      resolve();
    });
  });
  clearTimeout(timer);
  if (stdoutBuffer.trim()) handleLine(stdoutBuffer);

  const latencyMs = Date.now() - started;
  await rm(workdir, { recursive: true, force: true });

  if (process.env.KG_DUMP_TEXTS === "1") {
    const textDir = path.join(config.outDir, "texts");
    await mkdir(textDir, { recursive: true });
    await writeFile(
      path.join(textDir, `${task.id}-${arm}-rep${rep}.txt`),
      output.texts.join("\n"),
      "utf8",
    );
  }

  const extracted = extractAnswer(output.texts);
  const score = extracted.error
    ? { correct: false, reason: extracted.error }
    : scoreTask(task, extracted.answer, dataset);

  const fatal =
    output.fatal ??
    (FATAL_PATTERNS.some((pattern) => stderr.includes(pattern))
      ? FATAL_PATTERNS.find((pattern) => stderr.includes(pattern))
      : undefined);

  const classification = classifyAttempt({
    correct: score.correct,
    scoreReason: score.reason,
    answerError: extracted.error,
    timedOut,
    toolLimitExceeded,
    turnLimitExceeded,
    fatal,
  });

  return {
    runId: config.runId,
    model: config.model,
    arm,
    dataset: server.dataset,
    taskId: task.id,
    category: task.category,
    answerType: task.answer_type,
    rep,
    correct: score.correct,
    status: classification.status,
    statusReason: classification.reason,
    scoreReason: score.reason,
    answer: extracted.answer,
    answerError: extracted.error,
    tokens: output.tokens,
    toolCalls: output.toolCalls,
    toolNames: output.toolNames,
    turns: output.turns,
    latencyMs,
    timedOut,
    toolLimitExceeded,
    turnLimitExceeded,
    error: fatal ? fatal : undefined,
    fatal,
    sessionId: output.sessionId,
  };
}

function isValid(attempt: Attempt): boolean {
  return (
    !attempt.error &&
    !attempt.timedOut &&
    !attempt.toolLimitExceeded &&
    !attempt.turnLimitExceeded &&
    !attempt.answerError
  );
}

function classifyAttempt(args: {
  correct: boolean;
  scoreReason: string;
  answerError?: string;
  timedOut: boolean;
  toolLimitExceeded: boolean;
  turnLimitExceeded: boolean;
  fatal?: string;
}): { status: AttemptStatus; reason: string } {
  if (args.fatal) return { status: "error", reason: args.fatal };
  if (args.toolLimitExceeded)
    return { status: "tool_limit", reason: "tool-call limit exceeded" };
  if (args.turnLimitExceeded)
    return { status: "turn_limit", reason: "turn limit exceeded" };
  if (args.timedOut) return { status: "timeout", reason: "time budget exceeded" };
  if (args.correct) return { status: "correct", reason: args.scoreReason };
  if (args.answerError) return { status: "invalid_format", reason: args.answerError };
  return { status: "wrong_answer", reason: args.scoreReason };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[index]!;
}

function bootstrapCi(
  attempts: Attempt[],
  value: (attempt: Attempt) => number,
  iterations = 2000,
): [number, number] {
  if (attempts.length === 0) return [0, 0];
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < attempts.length; j += 1) {
      const pick = attempts[Math.floor(Math.random() * attempts.length)]!;
      sum += value(pick);
    }
    samples.push(sum / attempts.length);
  }
  return [percentile(samples, 0.025), percentile(samples, 0.975)];
}

function aggregate(attempts: Attempt[]): Aggregate {
  const valid = attempts.filter(isValid);
  // Cost metrics (tokens, tool calls, turns, latency) are averaged over ALL
  // attempts: a task that rambles and fails, or times out, still spent that
  // budget, so excluding it would understate an arm's true per-task cost.
  const accuracy = mean(attempts.map((attempt) => (attempt.correct ? 1 : 0)));
  const tokens = mean(attempts.map((attempt) => attempt.tokens.total));
  const toolCalls = mean(attempts.map((attempt) => attempt.toolCalls));
  return {
    n: attempts.length,
    invalid: attempts.length - valid.length,
    correct: attempts.filter((attempt) => attempt.correct).length,
    accuracy,
    tokens,
    toolCalls,
    turns: mean(attempts.map((attempt) => attempt.turns)),
    latencyMs: mean(attempts.map((attempt) => attempt.latencyMs)),
    tokenCi: bootstrapCi(attempts, (attempt) => attempt.tokens.total),
    toolCi: bootstrapCi(attempts, (attempt) => attempt.toolCalls),
    accuracyCi: bootstrapCi(attempts, (attempt) => (attempt.correct ? 1 : 0)),
  };
}

function grouped(
  attempts: Attempt[],
  key: (attempt: Attempt) => string,
): Record<string, Aggregate> {
  const groups = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const group = key(attempt);
    const list = groups.get(group) ?? [];
    list.push(attempt);
    groups.set(group, list);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([name, list]) => [name, aggregate(list)]),
  );
}

function focusAttempts(attempts: Attempt[]): Attempt[] {
  return attempts.filter((attempt) =>
    ["multi_hop", "path", "aggregate"].includes(attempt.category),
  );
}

function hypothesis(attempts: Attempt[]): {
  supported: boolean;
  inconclusive?: boolean;
  reason: string;
  arm: Aggregate;
  bestBaseline?: { arm: string; metrics: Aggregate };
} {
  const focus = focusAttempts(attempts);
  const byArm = grouped(focus, (attempt) => attempt.arm);
  const armA = byArm.a ?? aggregate([]);
  const baselines = ["b", "c"]
    .map((arm) => ({ arm, metrics: byArm[arm] }))
    .filter(
      (entry): entry is { arm: string; metrics: Aggregate } =>
        entry.metrics !== undefined,
    )
    .sort(
      (a, b) =>
        b.metrics.accuracy - a.metrics.accuracy ||
        a.metrics.tokens - b.metrics.tokens,
    );
  const best = baselines[0];
  if (focus.length === 0 || !byArm.a || !best) {
    return {
      supported: false,
      inconclusive: true,
      reason:
        focus.length === 0
          ? "no multi-hop, path, or aggregate attempts"
          : "no arm-A or baseline attempts in the focus categories",
      arm: armA,
    };
  }
  const accuracyOk = armA.accuracy >= best.metrics.accuracy - 0.05;
  const tokensOk = armA.tokens <= best.metrics.tokens * 0.75;
  const toolsOk = armA.toolCalls <= best.metrics.toolCalls * 0.7;
  const latencyOk = armA.latencyMs <= best.metrics.latencyMs * 1.2;
  const supported = accuracyOk && tokensOk && toolsOk && latencyOk;
  return {
    supported,
    arm: armA,
    bestBaseline: best,
    reason: [
      `accuracy ${(armA.accuracy * 100).toFixed(1)}% vs ${(
        best.metrics.accuracy * 100
      ).toFixed(1)}% (${accuracyOk ? "ok" : "fail"})`,
      `tokens ${armA.tokens.toFixed(0)} vs ${best.metrics.tokens.toFixed(
        0,
      )} (${tokensOk ? "ok" : "fail"})`,
      `tool calls ${armA.toolCalls.toFixed(1)} vs ${best.metrics.toolCalls.toFixed(
        1,
      )} (${toolsOk ? "ok" : "fail"})`,
      `latency ${armA.latencyMs.toFixed(0)}ms vs ${best.metrics.latencyMs.toFixed(
        0,
      )}ms (${latencyOk ? "ok" : "fail"})`,
    ].join("; "),
  };
}

function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function reportMarkdown(
  config: Config,
  attempts: Attempt[],
  aborted: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`# KG MCP evaluation: ${config.runId}`);
  lines.push("");
  lines.push(`- model: \`${config.model}\``);
  lines.push(`- arms: ${config.arms.join(", ")}`);
  lines.push(`- reps: ${config.reps}`);
  lines.push(`- attempts: ${attempts.length}`);
  lines.push(`- aborted: ${aborted ?? "no"}`);
  lines.push("");
  lines.push("## Overall");
  lines.push("");
  lines.push("| arm | n | invalid | accuracy | 95% CI | tokens | tokens 95% CI | tool calls | turns | latency ms |");
  lines.push("| --- | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: | ---: |");
  const overall = grouped(attempts, (attempt) => attempt.arm);
  for (const arm of config.arms) {
    const metrics = overall[arm];
    if (!metrics) continue;
    lines.push(
      `| ${arm} | ${metrics.n} | ${metrics.invalid} | ${(
        metrics.accuracy * 100
      ).toFixed(1)}% | ${(metrics.accuracyCi![0] * 100).toFixed(
        1,
      )}-${(metrics.accuracyCi![1] * 100).toFixed(1)}% | ${fmt(
        metrics.tokens,
        0,
      )} | ${fmt(metrics.tokenCi![0], 0)}-${fmt(
        metrics.tokenCi![1],
        0,
      )} | ${fmt(metrics.toolCalls)} | ${fmt(metrics.turns)} | ${fmt(
        metrics.latencyMs,
        0,
      )} |`,
    );
  }
  lines.push("");
  lines.push("## By category");
  lines.push("");
  lines.push("| category | arm | n | invalid | accuracy | tokens | tool calls | turns |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  const categories = [...new Set(attempts.map((attempt) => attempt.category))].sort();
  for (const category of categories) {
    const rows = grouped(
      attempts.filter((attempt) => attempt.category === category),
      (attempt) => attempt.arm,
    );
    for (const arm of config.arms) {
      const metrics = rows[arm];
      if (!metrics) continue;
      lines.push(
        `| ${category} | ${arm} | ${metrics.n} | ${metrics.invalid} | ${(
          metrics.accuracy * 100
        ).toFixed(1)}% | ${fmt(metrics.tokens, 0)} | ${fmt(
          metrics.toolCalls,
        )} | ${fmt(metrics.turns)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Pre-registered hypothesis");
  lines.push("");
  const result = hypothesis(attempts);
  lines.push(
    `Arm A vs best baseline on multi-hop/path/aggregate: **${
      result.inconclusive
        ? "INCONCLUSIVE"
        : result.supported
          ? "SUPPORTED"
          : "NOT SUPPORTED"
    }**`,
  );
  lines.push("");
  lines.push(result.reason);
  lines.push("");
  const failures = attempts.filter((attempt) => attempt.status !== "correct");
  if (failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    lines.push(
      "A wrong answer, a format miss, and a budget overrun (timeout / tool / turn limit) are distinct findings.",
    );
    lines.push("");
    const statuses: AttemptStatus[] = [
      "wrong_answer",
      "invalid_format",
      "timeout",
      "tool_limit",
      "turn_limit",
      "error",
    ];
    const byStatus = statuses
      .map((status) => ({
        status,
        n: failures.filter((failure) => failure.status === status).length,
      }))
      .filter((row) => row.n > 0);
    lines.push("| status | count |");
    lines.push("| --- | ---: |");
    for (const row of byStatus) lines.push(`| ${row.status} | ${row.n} |`);
    lines.push("");
    lines.push("| task | arm | rep | status | runtime ms | tokens | reason |");
    lines.push("| --- | --- | ---: | --- | ---: | ---: | --- |");
    for (const attempt of failures.slice(0, 200)) {
      lines.push(
        `| ${attempt.taskId} | ${attempt.arm} | ${attempt.rep} | ${attempt.status} | ${fmt(
          attempt.latencyMs,
          0,
        )} | ${fmt(attempt.tokens.total, 0)} | ${attempt.statusReason} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.outDir, { recursive: true });
  const allTasks = await readTasks();
  const tasks = selectedTasks(allTasks, config);
  if (tasks.length === 0) throw new Error("No tasks selected");

  const datasets = [...new Set(tasks.map((task) => task.dataset))];
  const scoringDatasets = new Map<DatasetName, LoadedDataset>();
  for (const name of datasets) {
    scoringDatasets.set(name, await loadDataset(name));
  }
  const servers = new Map<string, ServerHandle>();
  let port = config.portBase;
  try {
    for (const arm of config.arms) {
      for (const dataset of datasets) {
        const handle = await startServer(arm, dataset, port++, config);
        servers.set(handle.key, handle);
        console.log(`server ${handle.key} listening on ${handle.port}`);
      }
    }

    const opencodeConfigs = new Map<string, string>();
    for (const server of servers.values()) {
      opencodeConfigs.set(server.key, await writeOpencodeConfig(server, config));
    }

    await writeFile(
      path.join(config.outDir, "run.json"),
      JSON.stringify({ ...config, taskFilter: [...(config.taskFilter ?? [])] }, null, 2) +
        "\n",
      "utf8",
    );

    const rawPath = path.join(config.outDir, "raw.jsonl");
    await writeFile(rawPath, "", "utf8");
    const attempts: Attempt[] = [];
    let aborted: string | undefined;

    for (let rep = 1; rep <= config.reps; rep += 1) {
      for (const task of tasks) {
        for (const arm of config.arms) {
          const server = servers.get(serverKey(arm, task.dataset));
          if (!server) continue;
          const opencodeConfig = opencodeConfigs.get(server.key)!;
          const dataset = scoringDatasets.get(task.dataset);
          if (!dataset) throw new Error(`No scoring dataset for ${task.dataset}`);
          const attempt = await runAttempt({
            config,
            task,
            rep,
            arm,
            server,
            opencodeConfig,
            dataset,
          });
          attempts.push(attempt);
          await appendFile(rawPath, JSON.stringify(attempt) + "\n", "utf8");
          console.log(
            `${attempt.taskId} arm=${arm} rep=${rep} correct=${attempt.correct} tokens=${attempt.tokens.total} tools=${attempt.toolCalls}`,
          );
          if (attempt.fatal) {
            aborted = attempt.fatal;
            break;
          }
        }
        if (aborted) break;
      }
      if (aborted) break;
    }

    const summary = {
      runId: config.runId,
      model: config.model,
      arms: config.arms,
      reps: config.reps,
      tasks: tasks.map((task) => task.id),
      startedAt: new Date().toISOString(),
      aborted,
      attempts,
      overall: grouped(attempts, (attempt) => attempt.arm),
      byCategory: Object.fromEntries(
        [...new Set(attempts.map((attempt) => attempt.category))].map(
          (category) => [
            category,
            grouped(
              attempts.filter((attempt) => attempt.category === category),
              (attempt) => attempt.arm,
            ),
          ],
        ),
      ),
      hypothesis: hypothesis(attempts),
    };
    await writeFile(
      path.join(config.outDir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(config.outDir, "report.md"),
      reportMarkdown(config, attempts, aborted),
      "utf8",
    );
    console.log(`wrote ${config.outDir}`);
    if (aborted) {
      console.error(`ABORTED: ${aborted}`);
      process.exitCode = 2;
    }
  } finally {
    for (const server of servers.values()) {
      server.process.kill("SIGTERM");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const server of servers.values()) {
      if (server.process.exitCode === null) server.process.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
