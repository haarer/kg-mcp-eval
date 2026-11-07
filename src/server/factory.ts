import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loadDataset,
  type DatasetName,
  type LoadedDataset,
} from "../graph/load.js";
import { loadKuzuDataset, type KuzuDataset } from "./kuzu.js";
import { registerArmA } from "./tools/a.js";
import { registerArmB } from "./tools/b.js";
import { registerArmC } from "./tools/c.js";
import { registerCommonTools } from "./tools/validate.js";

export type Arm = "a" | "b" | "c";

export interface Runtime {
  arm: Arm;
  datasetName: DatasetName;
  dataset?: LoadedDataset;
  kuzu?: KuzuDataset;
  loadMs: number;
}

export function parseArm(value: string | undefined): Arm {
  if (value === "a" || value === "b" || value === "c") return value;
  throw new Error(`KG_ARM must be a, b, or c (got ${String(value)})`);
}

export function parseDataset(value: string | undefined): DatasetName {
  if (value === "hetionet" || value === "se-seed") return value;
  throw new Error(`KG_DATASET must be hetionet or se-seed (got ${String(value)})`);
}

export async function loadRuntime(
  arm: Arm,
  datasetName: DatasetName,
  options: { validate?: boolean } = {},
): Promise<Runtime> {
  const started = Date.now();
  if (arm === "b") {
    const kuzu = await loadKuzuDataset(datasetName);
    return {
      arm,
      datasetName,
      kuzu,
      loadMs: Date.now() - started,
    };
  }
  const dataset = await loadDataset(datasetName, {
    validate: options.validate ?? datasetName === "se-seed",
  });
  return {
    arm,
    datasetName,
    dataset,
    loadMs: Date.now() - started,
  };
}

export function createServer(runtime: Runtime): McpServer {
  const server = new McpServer({
    name: `kg-mcp-eval-arm-${runtime.arm}`,
    version: "0.1.0",
  });
  registerCommonTools(server);
  if (runtime.arm === "a") {
    if (!runtime.dataset) throw new Error("Arm A requires a loaded dataset");
    registerArmA(server, runtime.dataset);
  } else if (runtime.arm === "c") {
    if (!runtime.dataset) throw new Error("Arm C requires a loaded dataset");
    registerArmC(server, runtime.dataset);
  } else {
    if (!runtime.kuzu) throw new Error("Arm B requires a Kuzu dataset");
    registerArmB(server, runtime.kuzu);
  }
  return server;
}

export async function closeRuntime(runtime: Runtime): Promise<void> {
  if (runtime.kuzu) {
    await runtime.kuzu.db.close();
  }
}
