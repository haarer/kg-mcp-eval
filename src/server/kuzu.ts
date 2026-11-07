import kuzu from "kuzu";
import type { KuzuValue } from "kuzu";
import { createReadStream } from "node:fs";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { loadHetionetOntology } from "../ontology/adapters/hetionet.js";
import { loadSeSeedGraph } from "../ontology/adapters/se-seed.js";
import type { Ontology, OntologyIndex } from "../ontology/types.js";
import { indexOntology } from "../ontology/types.js";
import { assertValidOntology } from "../ontology/validate.js";
import type { DatasetName } from "../graph/load.js";
import { defaultDataDir } from "../graph/load.js";

const MANIFEST_VERSION = 1;

export interface KuzuDataset {
  name: DatasetName;
  ontology: Ontology;
  index: OntologyIndex;
  db: kuzu.Database;
  edgeTableByKind: Map<string, string>;
  loadMs: number;
  cacheHit: boolean;
  createConnection(): kuzu.Connection;
}

interface Manifest {
  version: number;
  dataset: string;
  nodes: number;
  edges: number;
  tables: Record<string, string>;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tableNames(ontology: Ontology): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const kind of ontology.edgeKinds) {
    let base = kind.id.replace(/[^A-Za-z0-9_]/g, "_");
    if (!base || /^[0-9]/.test(base)) base = `R_${base}`;
    let name = base;
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      name = `${base}_${counter}`;
      counter += 1;
    }
    used.add(name.toLowerCase());
    result.set(kind.id, name);
  }
  return result;
}

async function* readLines(
  file: string,
  compressed = false,
): AsyncGenerator<string> {
  const input = createReadStream(file);
  const stream = compressed ? input.pipe(createGunzip()) : input;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > 0) yield line;
  }
}

async function writeCsvFiles(
  dataDir: string,
  name: DatasetName,
  dir: string,
  ontology: Ontology,
  edgeTableByKind: Map<string, string>,
): Promise<{ nodesCsv: string; edgeCsvs: Map<string, string> }> {
  const csvDir = path.join(dir, "csv");
  mkdirSync(csvDir, { recursive: true });
  const nodesCsv = path.join(csvDir, "nodes.csv");
  const nodeStream = createWriteStream(nodesCsv);
  nodeStream.write("id,kind,label\n");

  const edgeCsvs = new Map<string, string>();
  const edgeStreams = new Map<string, ReturnType<typeof createWriteStream>>();
  for (const [kindId, table] of edgeTableByKind) {
    const file = path.join(csvDir, `${table}.csv`);
    edgeCsvs.set(kindId, file);
    const stream = createWriteStream(file);
    stream.write("from,to\n");
    edgeStreams.set(kindId, stream);
  }

  if (name === "hetionet") {
    let first = true;
    for await (const line of readLines(path.join(dataDir, "hetionet", "nodes.tsv"))) {
      if (first) {
        first = false;
        continue;
      }
      const [id, label, kind] = line.split("\t");
      if (!id || !label || !kind) throw new Error(`Malformed node row: ${line}`);
      if (!nodeStream.write(`${csvEscape(id)},${csvEscape(kind)},${csvEscape(label)}\n`)) {
        await once(nodeStream, "drain");
      }
    }
    first = true;
    for await (const line of readLines(
      path.join(dataDir, "hetionet", "edges.sif.gz"),
      true,
    )) {
      if (first) {
        first = false;
        continue;
      }
      const [source, kind, target] = line.split("\t");
      if (!source || !kind || !target) throw new Error(`Malformed edge row: ${line}`);
      const stream = edgeStreams.get(kind);
      if (!stream) throw new Error(`Unknown edge kind in data: ${kind}`);
      if (!stream.write(`${csvEscape(source)},${csvEscape(target)}\n`)) {
        await once(stream, "drain");
      }
    }
  } else {
    const graph = await loadSeSeedGraph(path.join(dataDir, "se-seed"));
    for (const node of graph.nodes) {
      if (
        !nodeStream.write(
          `${csvEscape(node.id)},${csvEscape(node.kind)},${csvEscape(node.label)}\n`,
        )
      ) {
        await once(nodeStream, "drain");
      }
    }
    for (const edge of graph.edges) {
      const stream = edgeStreams.get(edge.kind);
      if (!stream) throw new Error(`Unknown edge kind in data: ${edge.kind}`);
      if (
        !stream.write(`${csvEscape(edge.source)},${csvEscape(edge.target)}\n`)
      ) {
        await once(stream, "drain");
      }
    }
  }

  await Promise.all(
    [nodeStream, ...edgeStreams.values()].map(
      (stream) =>
        new Promise<void>((resolve, reject) => {
          stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
        }),
    ),
  );
  return { nodesCsv, edgeCsvs };
}

export async function loadKuzuDataset(
  name: DatasetName,
  options: { dataDir?: string; cacheDir?: string } = {},
): Promise<KuzuDataset> {
  const started = Date.now();
  const dataDir = options.dataDir ?? defaultDataDir();
  const ontology =
    name === "hetionet"
      ? await loadHetionetOntology(path.join(dataDir, "hetionet"))
      : (await loadSeSeedGraph(path.join(dataDir, "se-seed"))).ontology;
  assertValidOntology(ontology);
  const expectedNodes = ontology.counts?.nodes ?? 0;
  const expectedEdges = ontology.counts?.edges ?? 0;
  const edgeTableByKind = tableNames(ontology);
  const tablesObject = Object.fromEntries(edgeTableByKind);

  const cacheDir =
    options.cacheDir ??
    path.join(process.cwd(), "data", "cache", "kuzu", name);
  const dbPath = path.join(cacheDir, "db");
  const manifestPath = path.join(cacheDir, "manifest.json");

  let cacheHit = false;
  if (existsSync(manifestPath) && existsSync(dbPath)) {
    try {
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as Manifest;
      cacheHit =
        manifest.version === MANIFEST_VERSION &&
        manifest.dataset === name &&
        manifest.nodes === expectedNodes &&
        manifest.edges === expectedEdges &&
        JSON.stringify(manifest.tables) === JSON.stringify(tablesObject);
    } catch {
      cacheHit = false;
    }
  }

  if (!cacheHit) {
    rmSync(cacheDir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    const { nodesCsv, edgeCsvs } = await writeCsvFiles(
      dataDir,
      name,
      cacheDir,
      ontology,
      edgeTableByKind,
    );
    const db = new kuzu.Database(dbPath);
    const conn = new kuzu.Connection(db);
    await conn.query(
      "CREATE NODE TABLE Node(id STRING, kind STRING, label STRING, PRIMARY KEY(id))",
    );
    for (const table of edgeTableByKind.values()) {
      await conn.query(`CREATE REL TABLE ${table}(FROM Node TO Node)`);
    }
    await conn.query(`COPY Node FROM ${sqlString(nodesCsv)} (header=true, auto_detect=false)`);
    for (const [kindId, table] of edgeTableByKind) {
      const file = edgeCsvs.get(kindId);
      if (!file) continue;
      await conn.query(`COPY ${table} FROM ${sqlString(file)} (header=true, auto_detect=false)`);
    }
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: MANIFEST_VERSION,
          dataset: name,
          nodes: expectedNodes,
          edges: expectedEdges,
          tables: tablesObject,
        } satisfies Manifest,
        null,
        2,
      ),
    );
    await conn.close();
    await db.close();
  }

  const db = new kuzu.Database(dbPath);
  return {
    name,
    ontology,
    index: indexOntology(ontology),
    db,
    edgeTableByKind,
    loadMs: Date.now() - started,
    cacheHit,
    createConnection: () => new kuzu.Connection(db),
  };
}

const FORBIDDEN = [
  "CREATE",
  "MERGE",
  "DELETE",
  "SET",
  "REMOVE",
  "DROP",
  "ALTER",
  "COPY",
  "INSTALL",
  "LOAD",
  "ATTACH",
  "DETACH",
  "USE",
  "EXPORT",
  "IMPORT",
  "CALL",
];

export interface CypherResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = normalizeValue(inner);
    }
    return out;
  }
  return value;
}

export async function runCypher(
  runtime: KuzuDataset,
  query: string,
  options: { params?: Record<string, unknown>; limit?: number } = {},
): Promise<CypherResult> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 1000));
  const trimmed = query.trim().replace(/;\s*$/, "");
  if (!trimmed) throw new Error("Empty query");
  const withoutStrings = trimmed.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutStrings)) {
      throw new Error(`Mutating or unsupported keyword not allowed: ${keyword}`);
    }
  }
  const bounded = /\blimit\b/i.test(trimmed)
    ? trimmed
    : `${trimmed} LIMIT ${limit}`;
  const conn = runtime.createConnection();
  try {
    conn.setQueryTimeout(30_000);
    const result = options.params
      ? await conn.execute(
          await conn.prepare(bounded),
          options.params as Record<string, KuzuValue>,
        )
      : await conn.query(bounded);
    const single = Array.isArray(result) ? result[0] : result;
    if (!single) {
      return { columns: [], rows: [], rowCount: 0, truncated: false };
    }
    const all = (await single.getAll()).map(
      (row) => normalizeValue(row) as Record<string, unknown>,
    );
    const truncated = all.length > limit;
    const rows = all.slice(0, limit);
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
      rows,
      rowCount: rows.length,
      truncated,
    };
  } finally {
    await conn.close();
  }
}
