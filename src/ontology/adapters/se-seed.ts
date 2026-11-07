import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GraphEdgeInput, GraphNodeInput } from "../../graph/types.js";
import type { Ontology } from "../types.js";

export interface SeSeedGraph {
  ontology: Ontology;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
}

export async function loadSeSeedGraph(dir: string): Promise<SeSeedGraph> {
  const raw = await readFile(path.join(dir, "graph.json"), "utf8");
  return JSON.parse(raw) as SeSeedGraph;
}
