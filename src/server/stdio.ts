#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  closeRuntime,
  createServer,
  loadRuntime,
  parseArm,
  parseDataset,
} from "./factory.js";

async function main() {
  const arm = parseArm(process.env.KG_ARM ?? "a");
  const datasetName = parseDataset(process.env.KG_DATASET ?? "hetionet");
  const runtime = await loadRuntime(arm, datasetName, {
    validate: process.env.KG_VALIDATE === "1",
  });
  const server = createServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `kg-mcp-eval stdio arm=${arm} dataset=${datasetName} loaded in ${runtime.loadMs}ms`,
  );
  const shutdown = async () => {
    await closeRuntime(runtime);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
