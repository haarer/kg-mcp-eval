// Continuously appends a compact progress line for a benchmark run so you can
// `tail -f` the output file on the host.
//
//   node tools/progress-watch.mjs [runDir] [logFile] [outFile] [intervalSec]
//
// Defaults target the active full-44-v2 run. Stops after appending a COMPLETE
// line once all attempts are recorded.
import { readFileSync, existsSync, appendFileSync } from "node:fs";

const runDir =
  process.argv[2] ?? "/workspace/kg-mcp-eval/bench/results/full-44-v2";
const logFile = process.argv[3] ?? "/tmp/opencode/full-44-v2.log";
const outFile = process.argv[4] ?? `${runDir}/progress.log`;
const intervalSec = Number(process.argv[5] ?? 60);

function fmtHMS(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s).padStart(2, "0")}s`;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a partially-written trailing line
    }
  }
  return out;
}

function snapshot() {
  const run = JSON.parse(readFileSync(`${runDir}/run.json`, "utf8"));
  const m = run.runId.match(
    /run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
  );
  const startedAt = m
    ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
    : Date.now();
  const arms = run.arms ?? ["a", "b", "c"];
  const reps = run.reps ?? 3;
  const tf = "/workspace/kg-mcp-eval/bench/tasks/tasks.jsonl";
  const taskCount = existsSync(tf)
    ? readFileSync(tf, "utf8").split("\n").filter(Boolean).length
    : 44;
  const total = taskCount * arms.length * reps;

  const rows = readJsonl(`${runDir}/raw.jsonl`);
  const done = rows.length;
  const elapsed = (Date.now() - startedAt) / 1000;
  const remaining = Math.max(0, total - done);

  const byArm = {};
  for (const a of arms) byArm[a] = { n: 0, correct: 0, lat: 0 };
  for (const r of rows) {
    const s = byArm[r.arm];
    if (!s) continue;
    s.n++;
    if (r.correct) s.correct++;
    s.lat += r.latencyMs ?? 0;
  }
  let etaSec = 0;
  for (const a of arms) {
    const s = byArm[a];
    const meanLat = s.n ? s.lat / s.n : 60;
    etaSec += (remaining / arms.length) * (meanLat / 1000);
  }

  let retries = 0;
  let lastLine = "";
  if (existsSync(logFile)) {
    const txt = readFileSync(logFile, "utf8");
    retries = (txt.match(/\[retry/g) ?? []).length;
    lastLine = txt.trimEnd().split("\n").slice(-1)[0] ?? "";
  }
  const lastShort = lastLine.replace(/\s+/g, " ").trim();

  const pct = ((done / total) * 100).toFixed(1);
  const armStr = arms
    .map((a) => {
      const s = byArm[a];
      const acc = s.n ? ((s.correct / s.n) * 100).toFixed(0) : "-";
      const lat = s.n ? (s.lat / s.n / 1000).toFixed(0) : "-";
      return `${a}:${acc}%/${lat}s`;
    })
    .join(" ");
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const complete = done >= total || existsSync(`${runDir}/summary.json`);

  return {
    complete,
    line:
      `${ts} ${done}/${total} ${pct}% elapsed=${fmtHMS(elapsed)} ` +
      `eta=${fmtHMS(etaSec)} stalls=${retries} | ${armStr} | ` +
      `${complete ? "COMPLETE " : ""}last=${lastShort}`,
  };
}

const header =
  `# progress watch  run=${runDir}\n` +
  `# tail -f ${outFile}\n` +
  `# fields: done/total pct elapsed eta stalls | per-arm acc%/avgLat | last attempt\n`;
appendFileSync(outFile, header);
console.log(header);

while (true) {
  try {
    const { complete, line } = snapshot();
    appendFileSync(outFile, line + "\n");
    console.log(line);
    if (complete) break;
  } catch (e) {
    appendFileSync(outFile, `${new Date().toISOString()} error: ${e.message}\n`);
    console.log(`error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
