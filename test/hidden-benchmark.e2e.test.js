import test from "node:test";
import assert from "node:assert/strict";
import { runHiddenBenchmark } from "../src/benchmark/run-hidden.js";

test("blind hidden suite passes broken and clean-control cases", async () => {
  const result = await runHiddenBenchmark({ writeArtifacts: false });
  assert.equal(result.passed, true);
  assert.equal(result.cases.length, 2);

  const broken = result.cases.find((entry) => entry.caseId === "broken-v2");
  const clean = result.cases.find((entry) => entry.caseId === "clean-v2");

  assert.equal(broken.score.metrics.criticalMajorRecall, 1);
  assert.equal(broken.score.metrics.falsePositiveRate, 0);
  assert.equal(clean.score.metrics.confirmedCount, 0);
  assert.equal(clean.score.metrics.falsePositiveRate, 0);
});