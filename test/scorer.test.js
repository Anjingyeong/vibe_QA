import test from "node:test";
import assert from "node:assert/strict";
import { scoreBenchmark } from "../src/benchmark/scorer.js";

const truth = {
  issues: [
    { signature: "a", severity: "critical" },
    { signature: "b", severity: "major" },
    { signature: "c", severity: "minor" }
  ]
};

function finding(signature, reproducibility = 1) {
  return { signature, reproducibility };
}

test("scorer passes a precise reproducible result", () => {
  const score = scoreBenchmark(truth, {
    confirmed: [finding("a"), finding("b"), finding("c")]
  });
  assert.equal(score.passed, true);
  assert.equal(score.metrics.criticalMajorRecall, 1);
  assert.equal(score.metrics.falsePositiveRate, 0);
});

test("scorer fails when false positives are excessive", () => {
  const score = scoreBenchmark(truth, {
    confirmed: [finding("a"), finding("b"), finding("c"), finding("not-real")]
  });
  assert.equal(score.passed, false);
  assert.equal(score.metrics.falsePositiveRate, 0.25);
});

test("scorer passes a clean control with no expected or confirmed issues", () => {
  const score = scoreBenchmark({ issues: [] }, { confirmed: [] });
  assert.equal(score.passed, true);
  assert.equal(score.metrics.criticalMajorRecall, 1);
  assert.equal(score.metrics.falsePositiveRate, 0);
  assert.equal(score.metrics.reproducibility, 1);
  assert.equal(score.metrics.precision, 1);
});

test("scorer fails when even one confirmed finding is not reproducible across all runs", () => {
  const score = scoreBenchmark(truth, {
    confirmed: [finding("a", 1), finding("b", 2 / 3), finding("c", 1)]
  });
  assert.equal(score.passed, false);
  assert.equal(score.metrics.reproducibility, 2 / 3);
  assert.ok(score.metrics.averageReproducibility > score.metrics.reproducibility);
});
