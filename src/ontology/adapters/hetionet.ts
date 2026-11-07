import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Ontology } from "../types.js";

export async function loadHetionetOntology(dir: string): Promise<Ontology> {
  const raw = await readFile(path.join(dir, "ontology.json"), "utf8");
  return JSON.parse(raw) as Ontology;
}
