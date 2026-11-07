import type { LoadedDataset } from "../graph/load.js";
import { Oracle } from "../oracle/oracle.js";
import type { Task } from "./generate.js";

export interface ScoreResult {
  correct: boolean;
  reason: string;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === "string")) return undefined;
  return value as string[];
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

function pathObject(
  value: unknown,
): { nodes: string[]; edges: string[] } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const nodes = stringArray(record.nodes);
  const edges = stringArray(record.edges);
  if (!nodes || !edges) return undefined;
  return { nodes, edges };
}

function setEqual(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export function scoreTask(
  task: Task,
  answer: unknown,
  dataset: LoadedDataset,
): ScoreResult {
  const oracle = new Oracle(dataset);

  switch (task.answer_type) {
    case "id": {
      if (typeof answer !== "string") {
        return { correct: false, reason: "answer is not a string" };
      }
      return {
        correct: answer === task.gold,
        reason: answer === task.gold ? "exact id" : `expected ${task.gold}`,
      };
    }
    case "id_set":
    case "kind_set": {
      const values = stringArray(answer);
      if (!values) return { correct: false, reason: "answer is not a string array" };
      const gold = task.gold as string[];
      return {
        correct: setEqual(values, gold),
        reason: setEqual(values, gold)
          ? "set match"
          : `expected set of ${gold.length}; got ${new Set(values).size}`,
      };
    }
    case "number": {
      const value = numberValue(answer);
      if (value === undefined) {
        return { correct: false, reason: "answer is not a number" };
      }
      return {
        correct: value === task.gold,
        reason: value === task.gold ? "exact number" : `expected ${task.gold}`,
      };
    }
    case "boolean": {
      const value = booleanValue(answer);
      if (value === undefined) {
        return { correct: false, reason: "answer is not a boolean" };
      }
      return {
        correct: value === task.gold,
        reason: value === task.gold ? "exact boolean" : `expected ${task.gold}`,
      };
    }
    case "path": {
      const path = pathObject(answer);
      if (!path) return { correct: false, reason: "answer is not {nodes,edges}" };
      const constraint = task.gold as {
        from: string;
        to: string;
        maxHops: number;
        allowedEdgeKinds?: string[];
        direction?: "out" | "in" | "both";
      };
      const allowed =
        constraint.allowedEdgeKinds ??
        (task.constraints?.edgeKinds as string[] | undefined);
      const correct = oracle.isValidPath(path.nodes, path.edges, {
        from: constraint.from,
        to: constraint.to,
        maxHops: constraint.maxHops,
        allowedEdgeKinds: allowed,
        direction: constraint.direction ?? "both",
      });
      return {
        correct,
        reason: correct ? "valid path" : "path does not satisfy constraints",
      };
    }
    case "path_exists": {
      if (!answer || typeof answer !== "object") {
        return { correct: false, reason: "answer is not an object" };
      }
      const record = answer as Record<string, unknown>;
      const exists = booleanValue(record.exists ?? record.answer);
      if (exists === undefined) {
        return { correct: false, reason: "missing boolean exists" };
      }
      const gold = task.gold as {
        from: string;
        to: string;
        maxHops: number;
        allowedEdgeKinds?: string[];
        direction?: "out" | "in" | "both";
        exists: boolean;
      };
      if (!gold.exists) {
        return {
          correct: exists === false,
          reason: exists === false ? "correctly false" : "expected false",
        };
      }
      if (exists !== true) {
        return { correct: false, reason: "expected true" };
      }
      const path = pathObject(record);
      if (!path) {
        return { correct: false, reason: "expected true with a path" };
      }
      const allowed =
        gold.allowedEdgeKinds ??
        (task.constraints?.edgeKinds as string[] | undefined);
      const correct = oracle.isValidPath(path.nodes, path.edges, {
        from: gold.from,
        to: gold.to,
        maxHops: gold.maxHops,
        allowedEdgeKinds: allowed,
        direction: gold.direction ?? "both",
      });
      return {
        correct,
        reason: correct ? "valid path" : "path does not satisfy constraints",
      };
    }
    default:
      return { correct: false, reason: `unknown answer type ${task.answer_type}` };
  }
}
