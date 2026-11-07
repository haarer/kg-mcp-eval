import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { loadHetionetOntology } from "../ontology/adapters/hetionet.js";
import { loadSeSeedGraph } from "../ontology/adapters/se-seed.js";
import type { Ontology, OntologyIndex } from "../ontology/types.js";
import { indexOntology } from "../ontology/types.js";
import { assertValidOntology, validateGraph } from "../ontology/validate.js";
import { GraphBuilder, type GraphStore } from "./store.js";

export type DatasetName = "hetionet" | "se-seed";

export interface LoadedDataset {
  name: DatasetName;
  ontology: Ontology;
  index: OntologyIndex;
  store: GraphStore;
  loadMs: number;
}

export interface LoadOptions {
  dataDir?: string;
  validate?: boolean;
}

export function defaultDataDir(): string {
  return (
    process.env.KG_DATA_DIR ??
    path.resolve(process.cwd(), "data", "normalized")
  );
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

async function loadHetionet(
  dir: string,
  options: LoadOptions,
  started: number,
): Promise<LoadedDataset> {
  const ontology = await loadHetionetOntology(dir);
  assertValidOntology(ontology);
  const builder = new GraphBuilder();

  let first = true;
  for await (const line of readLines(path.join(dir, "nodes.tsv"))) {
    if (first) {
      first = false;
      continue;
    }
    const [id, label, kind] = line.split("\t");
    if (!id || !label || !kind) {
      throw new Error(`Malformed node row: ${line}`);
    }
    builder.addNode({ id, label, kind });
  }

  first = true;
  for await (const line of readLines(path.join(dir, "edges.sif.gz"), true)) {
    if (first) {
      first = false;
      continue;
    }
    const [source, kind, target] = line.split("\t");
    if (!source || !kind || !target) {
      throw new Error(`Malformed edge row: ${line}`);
    }
    builder.addEdge({ source, target, kind });
  }

  const store = builder.finish();
  if (options.validate) {
    const graph = await loadHetionetGraphForValidation(dir);
    const report = validateGraph(ontology, graph.nodes, graph.edges);
    if (report.issues.length > 0) {
      throw new Error(
        `Hetionet failed ontology validation:\n${report.issues
          .map((i) => `- ${i.message}`)
          .join("\n")}`,
      );
    }
  }
  return {
    name: "hetionet",
    ontology,
    index: indexOntology(ontology),
    store,
    loadMs: Date.now() - started,
  };
}

async function loadHetionetGraphForValidation(
  dir: string,
): Promise<{ nodes: { id: string; label: string; kind: string }[]; edges: { source: string; target: string; kind: string }[] }> {
  const nodes: { id: string; label: string; kind: string }[] = [];
  let first = true;
  for await (const line of readLines(path.join(dir, "nodes.tsv"))) {
    if (first) {
      first = false;
      continue;
    }
    const [id, label, kind] = line.split("\t");
    if (id && label && kind) nodes.push({ id, label, kind });
  }
  const edges: { source: string; target: string; kind: string }[] = [];
  first = true;
  for await (const line of readLines(path.join(dir, "edges.sif.gz"), true)) {
    if (first) {
      first = false;
      continue;
    }
    const [source, kind, target] = line.split("\t");
    if (source && target && kind) edges.push({ source, target, kind });
  }
  return { nodes, edges };
}

async function loadSeSeed(
  dir: string,
  started: number,
): Promise<LoadedDataset> {
  const graph = await loadSeSeedGraph(dir);
  assertValidOntology(graph.ontology);
  const report = validateGraph(graph.ontology, graph.nodes, graph.edges);
  if (report.issues.length > 0) {
    throw new Error(
      `SE seed failed ontology validation:\n${report.issues
        .map((i) => `- ${i.message}`)
        .join("\n")}`,
    );
  }
  const builder = new GraphBuilder();
  for (const node of graph.nodes) builder.addNode(node);
  for (const edge of graph.edges) builder.addEdge(edge);
  return {
    name: "se-seed",
    ontology: graph.ontology,
    index: indexOntology(graph.ontology),
    store: builder.finish(),
    loadMs: Date.now() - started,
  };
}

export async function loadDataset(
  name: DatasetName,
  options: LoadOptions = {},
): Promise<LoadedDataset> {
  const started = Date.now();
  const dataDir = options.dataDir ?? defaultDataDir();
  if (name === "hetionet") {
    return loadHetionet(path.join(dataDir, "hetionet"), options, started);
  }
  if (name === "se-seed") {
    return loadSeSeed(path.join(dataDir, "se-seed"), started);
  }
  throw new Error(`Unknown dataset: ${String(name)}`);
}
