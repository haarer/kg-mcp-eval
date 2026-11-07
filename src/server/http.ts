#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  closeRuntime,
  createServer,
  loadRuntime,
  parseArm,
  parseDataset,
  type Runtime,
} from "./factory.js";

async function main() {
  const arm = parseArm(process.env.KG_ARM ?? "a");
  const datasetName = parseDataset(process.env.KG_DATASET ?? "hetionet");
  const host = process.env.KG_HOST ?? "127.0.0.1";
  const port = Number(process.env.KG_PORT ?? 8765);
  const log = process.env.KG_LOG === "1";

  const runtime = await loadRuntime(arm, datasetName, {
    validate: process.env.KG_VALIDATE === "1",
  });
  console.error(
    `kg-mcp-eval arm=${arm} dataset=${datasetName} loaded in ${runtime.loadMs}ms` +
      (runtime.kuzu ? ` (kuzu cache ${runtime.kuzu.cacheHit ? "hit" : "miss"})` : ""),
  );

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          arm,
          dataset: datasetName,
          nodes: runtime.dataset?.store.nodeCount ?? runtime.kuzu?.ontology.counts?.nodes,
          edges: runtime.dataset?.store.edgeCount ?? runtime.kuzu?.ontology.counts?.edges,
          loadMs: runtime.loadMs,
          cacheHit: runtime.kuzu?.cacheHit,
        }),
      );
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    if (log) {
      console.error(`mcp ${req.method} ${url.pathname}`);
    }
    const server = createServer(runtime);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("mcp request failed", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`kg-mcp-eval listening on http://${host}:${port}/mcp`);
  });

  const shutdown = async (signal: string) => {
    console.error(`received ${signal}, shutting down`);
    httpServer.close();
    await closeRuntime(runtime);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
