import assert from "node:assert/strict";
import { test } from "node:test";
import { balancedJsonSpans, extractAnswer } from "../bench/harness/answer.js";

test("extractAnswer returns the root path object, not a nested edge array", () => {
  const text = [
    "I found valid paths. Let me verify one of them to be safe.",
    "",
    "The path is verified. All edges are bidirectional, so the 3-hop path is valid.",
    "",
    '{"answer": {"nodes": ["Cellular Component::GO:0001739", "Gene::6045", "Biological Process::GO:0007417", "Gene::5795"], "edges": ["GpCC", "GpBP", "GpBP"]}}',
  ].join("\n");
  const result = extractAnswer([text]);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.answer, {
    nodes: [
      "Cellular Component::GO:0001739",
      "Gene::6045",
      "Biological Process::GO:0007417",
      "Gene::5795",
    ],
    edges: ["GpCC", "GpBP", "GpBP"],
  });
});

test("balancedJsonSpans drops nested spans and keeps only roots", () => {
  const spans = balancedJsonSpans('x {"a": [1, 2], "b": {"c": 3}} y');
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.text, '{"a": [1, 2], "b": {"c": 3}}');
});

test("extractAnswer handles set, number, boolean, and path_exists shapes", () => {
  assert.deepEqual(extractAnswer(['{"answer": ["Gene::1", "Gene::2"]}']).answer, [
    "Gene::1",
    "Gene::2",
  ]);
  assert.equal(extractAnswer(["The count is 4.", '{"answer": 4}']).answer, 4);
  assert.deepEqual(extractAnswer(['{"answer": {"exists": false}}']).answer, {
    exists: false,
  });
  // bare array (no wrapper)
  assert.deepEqual(extractAnswer(['["A", "B"]']).answer, ["A", "B"]);
});

test("extractAnswer prefers the last root JSON when prose follows earlier JSON", () => {
  const text = ['First I tried {"answer": 1}, but that is wrong.', 'Final: {"answer": 7}'].join(
    "\n",
  );
  assert.equal(extractAnswer([text]).answer, 7);
});

test("extractAnswer reports no parseable answer for pure prose", () => {
  const result = extractAnswer(["I could not find any path between the two nodes."]);
  assert.equal(result.answer, undefined);
  assert.match(result.error ?? "", /no parseable JSON answer/);
});
