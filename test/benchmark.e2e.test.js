import test from "node:test";
import assert from "node:assert/strict";
import { runBenchmark } from "../src/benchmark/run.js";

test("seeded benchmark clears the initial trust gate", async () => {
  const result = await runBenchmark({ runCount: 3, writeArtifacts: false });

  assert.equal(result.score.passed, true);
  assert.ok(result.score.metrics.criticalMajorRecall >= 0.90);
  assert.ok(result.score.metrics.falsePositiveRate <= 0.10);
  assert.ok(result.score.metrics.reproducibility >= 0.95);
  assert.equal(result.score.metrics.falsePositiveCount, 0);
});
