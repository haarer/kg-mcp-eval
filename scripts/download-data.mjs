#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw");
const normalizedDir = path.join(root, "data", "normalized");
const hetDir = path.join(normalizedDir, "hetionet");
const seedDir = path.join(normalizedDir, "se-seed");
const force = process.argv.includes("--force");

const SOURCES = {
  nodes:
    "https://raw.githubusercontent.com/hetio/hetionet/main/hetnet/tsv/hetionet-v1.0-nodes.tsv",
  edges:
    "https://media.githubusercontent.com/media/hetio/hetionet/main/hetnet/tsv/hetionet-v1.0-edges.sif.gz",
  metagraph:
    "https://raw.githubusercontent.com/hetio/hetionet/main/hetnet/json/hetionet-v1.0-metagraph.json",
  metanodes:
    "https://raw.githubusercontent.com/hetio/hetionet/main/describe/nodes/metanodes.tsv",
  metaedges:
    "https://raw.githubusercontent.com/hetio/hetionet/main/describe/edges/metaedges.tsv",
};

const FILES = {
  nodes: path.join(rawDir, "hetionet-nodes.tsv"),
  edges: path.join(rawDir, "hetionet-edges.sif.gz"),
  metagraph: path.join(rawDir, "hetionet-metagraph.json"),
  metanodes: path.join(rawDir, "hetionet-metanodes.tsv"),
  metaedges: path.join(rawDir, "hetionet-metaedges.tsv"),
};

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (!force && (await exists(dest))) {
    console.log(`skip   ${path.basename(dest)}`);
    return;
  }
  console.log(`fetch  ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const sink = createWriteStream(tmp);
  for await (const chunk of response.body) {
    if (!sink.write(chunk)) {
      await new Promise((resolve) => sink.once("drain", resolve));
    }
  }
  await new Promise((resolve, reject) => {
    sink.end((err) => (err ? reject(err) : resolve()));
  });
  await copyFile(tmp, dest);
  const fs = await import("node:fs/promises");
  await fs.rm(tmp, { force: true });
}

async function* readLines(file, compressed = false) {
  const input = createReadStream(file);
  const stream = compressed ? input.pipe(createGunzip()) : input;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function readTsv(file) {
  const rows = [];
  let header = null;
  for await (const line of readLines(file)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (!header) {
      header = cols;
      continue;
    }
    rows.push(Object.fromEntries(header.map((h, i) => [h, cols[i]])));
  }
  return rows;
}

async function countLines(file, compressed = false) {
  let count = 0;
  let skippedHeader = false;
  for await (const line of readLines(file, compressed)) {
    if (!line) continue;
    if (!skippedHeader) {
      skippedHeader = true;
      continue;
    }
    count += 1;
  }
  return count;
}

function parseMetaedge(metaedge) {
  const parts = metaedge.split(/ - | > /);
  if (parts.length !== 3) {
    throw new Error(`Unexpected metaedge format: ${metaedge}`);
  }
  return { source: parts[0], kind: parts[1], target: parts[2] };
}

async function buildHetionet() {
  const metagraph = JSON.parse(await readFile(FILES.metagraph, "utf8"));
  const directions = new Map();
  for (const [source, target, kind, direction] of metagraph.metaedge_tuples) {
    directions.set(`${source}\u0000${target}\u0000${kind}`, direction);
  }

  const metanodes = await readTsv(FILES.metanodes);
  const metaedges = await readTsv(FILES.metaedges);

  const nodeKinds = metanodes.map((row) => ({
    id: row.metanode,
    label: row.metanode,
    abbreviation: row.abbreviation,
  }));

  const edgeKinds = [];
  const edgeCounts = {};
  let edgeTotal = 0;
  for (const row of metaedges) {
    const { source, kind, target } = parseMetaedge(row.metaedge);
    const direction = directions.get(`${source}\u0000${target}\u0000${kind}`);
    if (!direction) {
      throw new Error(`No direction for metaedge ${row.metaedge}`);
    }
    edgeKinds.push({
      id: row.abbreviation,
      label: row.metaedge,
      direction,
      endpoints: [{ source, target }],
    });
    edgeCounts[row.abbreviation] = Number(row.edges);
    edgeTotal += Number(row.edges);
  }

  const nodeCounts = {};
  let nodeTotal = 0;
  for (const row of metanodes) {
    nodeCounts[row.metanode] = Number(row.nodes);
    nodeTotal += Number(row.nodes);
  }

  const ontology = {
    name: "hetionet",
    version: "1.0",
    source: "https://github.com/hetio/hetionet",
    nodeKinds,
    edgeKinds,
    counts: {
      nodes: nodeTotal,
      edges: edgeTotal,
      nodeKinds: nodeCounts,
      edgeKinds: edgeCounts,
    },
  };

  await mkdir(hetDir, { recursive: true });
  await writeFile(
    path.join(hetDir, "ontology.json"),
    JSON.stringify(ontology, null, 2),
  );

  const nodeCount = await countLines(FILES.nodes, false);
  const edgeCount = await countLines(FILES.edges, true);
  if (nodeCount !== nodeTotal) {
    throw new Error(
      `Node count mismatch: file has ${nodeCount}, metanodes say ${nodeTotal}`,
    );
  }
  if (edgeCount !== edgeTotal) {
    throw new Error(
      `Edge count mismatch: file has ${edgeCount}, metaedges say ${edgeTotal}`,
    );
  }

  await copyFile(FILES.nodes, path.join(hetDir, "nodes.tsv"));
  await copyFile(FILES.edges, path.join(hetDir, "edges.sif.gz"));

  console.log(
    `hetionet: ${nodeCount} nodes, ${edgeCount} edges, ${nodeKinds.length} node kinds, ${edgeKinds.length} edge kinds`,
  );
}

async function buildSeed() {
  const source = path.join(root, "data", "seeds", "se-seed.graph.json");
  const graph = JSON.parse(await readFile(source, "utf8"));
  await mkdir(seedDir, { recursive: true });
  await writeFile(
    path.join(seedDir, "graph.json"),
    JSON.stringify(graph, null, 2),
  );
  const ontology = graph.ontology;
  ontology.counts = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    nodeKinds: Object.fromEntries(
      ontology.nodeKinds.map((k) => [
        k.id,
        graph.nodes.filter((n) => n.kind === k.id).length,
      ]),
    ),
    edgeKinds: Object.fromEntries(
      ontology.edgeKinds.map((k) => [
        k.id,
        graph.edges.filter((e) => e.kind === k.id).length,
      ]),
    ),
  };
  console.log(
    `se-seed: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${ontology.nodeKinds.length} node kinds, ${ontology.edgeKinds.length} edge kinds`,
  );
}

async function writeNotice() {
  const notice = `# Data notice

## Hetionet v1.0

Source: https://github.com/hetio/hetionet

Hetionet integrates data from multiple public resources. Node and edge
properties carry their own source and license information in the upstream
JSON export. The tabular export used here is distributed by the Hetionet
project. Cite:

- Himmelstein, D. S. et al. "Systematic integration of biomedical knowledge
  prioritizes drugs for repurposing." eLife 6, e26726 (2017).
  https://doi.org/10.7554/eLife.26726

## SE seed

Hand-authored for this experiment. No third-party data.
`;
  await writeFile(path.join(root, "data", "NOTICE.md"), notice);
}

async function main() {
  await mkdir(rawDir, { recursive: true });
  for (const [key, url] of Object.entries(SOURCES)) {
    await download(url, FILES[key]);
  }
  await buildHetionet();
  await buildSeed();
  await writeNotice();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
