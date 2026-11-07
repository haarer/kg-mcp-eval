import type { LoadedDataset } from "../graph/load.js";
import { Oracle } from "../oracle/oracle.js";
import type { Task } from "./generate.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateTask(task: Task, dataset: LoadedDataset): void {
  const oracle = new Oracle(dataset);
  const store = dataset.store;

  switch (task.answer_type) {
    case "id": {
      assert(typeof task.gold === "string", `${task.id}: id gold must be string`);
      assert(
        store.indexOf(task.gold) !== undefined,
        `${task.id}: unknown id ${task.gold}`,
      );
      break;
    }
    case "id_set": {
      assert(Array.isArray(task.gold), `${task.id}: id_set gold must be array`);
      for (const id of task.gold as string[]) {
        assert(store.indexOf(id) !== undefined, `${task.id}: unknown id ${id}`);
      }
      break;
    }
    case "kind_set": {
      assert(Array.isArray(task.gold), `${task.id}: kind_set gold must be array`);
      const kinds = new Set(dataset.ontology.nodeKinds.map((k) => k.id));
      for (const kind of task.gold as string[]) {
        assert(kinds.has(kind), `${task.id}: unknown kind ${kind}`);
      }
      break;
    }
    case "number":
      assert(
        typeof task.gold === "number",
        `${task.id}: number gold must be number`,
      );
      break;
    case "boolean":
      assert(
        typeof task.gold === "boolean",
        `${task.id}: boolean gold must be boolean`,
      );
      break;
    case "path": {
      const constraint = task.gold as {
        from: string;
        to: string;
        maxHops: number;
        direction?: "out" | "in" | "both";
      };
      const from = store.indexOf(constraint.from);
      const to = store.indexOf(constraint.to);
      assert(from !== undefined, `${task.id}: unknown id ${constraint.from}`);
      assert(to !== undefined, `${task.id}: unknown id ${constraint.to}`);
      const result = store.path(from, to, {
        direction: constraint.direction ?? "both",
        maxHops: constraint.maxHops,
        limit: 1,
      });
      assert(result.paths.length > 0, `${task.id}: gold path does not exist`);
      assert(
        oracle.isValidPath(
          result.paths[0]!.nodes,
          result.paths[0]!.edges,
          constraint,
        ),
        `${task.id}: oracle rejected generated path`,
      );
      break;
    }
    case "path_exists": {
      const constraint = task.gold as {
        from: string;
        to: string;
        maxHops: number;
        allowedEdgeKinds?: string[];
        direction?: "out" | "in" | "both";
        exists: boolean;
      };
      const exists = oracle.hasPath({
        from: constraint.from,
        to: constraint.to,
        maxHops: constraint.maxHops,
        allowedEdgeKinds: constraint.allowedEdgeKinds,
        direction: constraint.direction ?? "both",
      });
      assert(
        exists === constraint.exists,
        `${task.id}: oracle path existence ${exists} != gold ${constraint.exists}`,
      );
      break;
    }
    default:
      throw new Error(`${task.id}: unknown answer type ${task.answer_type}`);
  }
}

export function validateTasks(
  tasks: Task[],
  datasets: Record<string, LoadedDataset>,
): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    assert(!ids.has(task.id), `Duplicate task id: ${task.id}`);
    ids.add(task.id);
    const dataset = datasets[task.dataset];
    assert(dataset, `${task.id}: no dataset loaded for ${task.dataset}`);
    validateTask(task, dataset);
  }
}
