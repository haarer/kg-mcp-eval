import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAnswer,
  validateAnswerShape,
} from "../src/server/tools/validate.js";

test("validateAnswer accepts every answer shape", () => {
  assert.deepEqual(validateAnswer('{"answer": ["Gene::1", "Gene::2"]}'), {
    valid: true,
    shape: "id_set",
  });
  assert.deepEqual(validateAnswer('{"answer": "Gene::1"}'), {
    valid: true,
    shape: "id",
  });
  assert.deepEqual(validateAnswer('{"answer": 4}'), { valid: true, shape: "number" });
  assert.deepEqual(validateAnswer('{"answer": false}'), {
    valid: true,
    shape: "boolean",
  });
  assert.deepEqual(
    validateAnswer('{"answer": {"nodes": ["A", "B", "C"], "edges": ["E1", "E2"]}}'),
    { valid: true, shape: "path" },
  );
  assert.deepEqual(validateAnswer('{"answer": {"exists": false}}'), {
    valid: true,
    shape: "path_exists",
  });
  assert.deepEqual(
    validateAnswer(
      '{"answer": {"exists": true, "nodes": ["A", "B"], "edges": ["E1"]}}',
    ),
    { valid: true, shape: "path_exists" },
  );
});

test("validateAnswer rejects malformed answers", () => {
  assert.equal(validateAnswer("not json").valid, false);
  assert.equal(validateAnswer('["A"]').valid, false);
  assert.match(validateAnswer('["A"]').reason ?? "", /"answer"/);
  // path with mismatched node/edge counts
  const badPath = validateAnswer(
    '{"answer": {"nodes": ["A", "B"], "edges": ["E1", "E2"]}}',
  );
  assert.equal(badPath.valid, false);
  assert.match(badPath.reason ?? "", /one longer/);
  // path-existence true without a path
  assert.equal(
    validateAnswer('{"answer": {"exists": true}}').valid,
    false,
  );
  // array with non-strings
  assert.equal(validateAnswer('{"answer": [1, 2]}').valid, false);
});

test("validateAnswerShape classifies bare values", () => {
  assert.equal(validateAnswerShape(["A"]).shape, "id_set");
  assert.equal(validateAnswerShape(3).shape, "number");
  assert.equal(validateAnswerShape(true).shape, "boolean");
  assert.equal(
    validateAnswerShape({ nodes: ["A", "B"], edges: ["E1"] }).shape,
    "path",
  );
});
