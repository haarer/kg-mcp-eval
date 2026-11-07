import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/graph/load.js";
import { assertValidOntology } from "../src/ontology/validate.js";
import { isSubtypeOf } from "../src/ontology/types.js";
import { Oracle } from "../src/oracle/oracle.js";

test("SE ontology hierarchy and edge endpoint rules", async () => {
  const dataset = await loadDataset("se-seed");
  assertValidOntology(dataset.ontology);
  const oracle = new Oracle(dataset);

  assert.deepEqual(oracle.subtypes("Component"), [
    "HardwareComponent",
    "SoftwareComponent",
  ]);
  assert.equal(isSubtypeOf(dataset.index, "SoftwareComponent", "Element"), true);
  assert.equal(isSubtypeOf(dataset.index, "Element", "Component"), false);

  assert.equal(
    oracle.edgeKindAllows("satisfies", "SoftwareComponent", "SafetyRequirement"),
    true,
  );
  assert.equal(oracle.edgeKindAllows("satisfies", "TestCase", "Function"), false);
  assert.equal(oracle.edgeKindAllows("contains", "System", "Component"), true);
  assert.equal(oracle.edgeKindAllows("contains", "TestCase", "System"), false);
});
