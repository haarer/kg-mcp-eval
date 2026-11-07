import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface ShapeCheck {
  ok: boolean;
  shape?: string;
  reason?: string;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateAnswerShape(value: unknown): ShapeCheck {
  if (Array.isArray(value)) {
    if (isStringArray(value)) return { ok: true, shape: "id_set" };
    return { ok: false, reason: "array answers must contain only string node ids" };
  }
  if (typeof value === "string") return { ok: true, shape: "id" };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, shape: "number" };
  }
  if (typeof value === "boolean") return { ok: true, shape: "boolean" };
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("exists" in record) {
      if (typeof record.exists !== "boolean") {
        return { ok: false, reason: "exists must be a boolean" };
      }
      if (record.exists === false) return { ok: true, shape: "path_exists" };
      if (
        isStringArray(record.nodes) &&
        isStringArray(record.edges) &&
        (record.nodes as string[]).length === (record.edges as string[]).length + 1
      ) {
        return { ok: true, shape: "path_exists" };
      }
      return {
        ok: false,
        reason:
          "path-existence with exists=true also needs string arrays nodes and edges, with nodes one longer than edges",
      };
    }
    if ("nodes" in record || "edges" in record) {
      if (
        isStringArray(record.nodes) &&
        isStringArray(record.edges) &&
        (record.nodes as string[]).length === (record.edges as string[]).length + 1
      ) {
        return { ok: true, shape: "path" };
      }
      return {
        ok: false,
        reason:
          "path answers need string arrays nodes and edges, with nodes one longer than edges",
      };
    }
    return {
      ok: false,
      reason:
        'object answers must be a path {"nodes":[...],"edges":[...]} or a path-existence {"exists":bool,...}',
    };
  }
  return { ok: false, reason: "unsupported answer value" };
}

export function validateAnswer(candidate: string): {
  valid: boolean;
  shape?: string;
  reason?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      valid: false,
      reason: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("answer" in parsed)
  ) {
    return {
      valid: false,
      reason: 'final answer must be exactly one JSON object of the form {"answer": <value>}',
    };
  }
  const inner = validateAnswerShape((parsed as Record<string, unknown>).answer);
  return inner.ok
    ? { valid: true, shape: inner.shape }
    : { valid: false, reason: inner.reason };
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function registerCommonTools(server: McpServer): void {
  server.registerTool(
    "validate_answer",
    {
      description:
        "Check that your proposed final answer is well-formed before you finish. Pass the EXACT JSON string you intend to output. Returns {valid, shape} or {valid:false, reason}. This checks format only; it does not tell you whether the answer is correct.",
      inputSchema: z.object({
        candidate: z
          .string()
          .describe('The final answer JSON, e.g. {"answer": [ ... ]}'),
      }),
    },
    async (args) => text(validateAnswer(args.candidate)),
  );
}
