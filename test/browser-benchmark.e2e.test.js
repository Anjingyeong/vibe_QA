import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { runBrowserBenchmark } from "../src/benchmark/run-browser.js";

test("Playwright browser suite produces repeatable evidence on desktop and mobile", { timeout: 30_000 }, async () => {
  const result = await runBrowserBenchmark({ runCount: 2, writeArtifacts: false });
  assert.equal(result.passed, true);

  const broken = result.cases.find((entry) => entry.caseId === "broken-browser-v1");
  const clean = result.cases.find((entry) => entry.caseId === "clean-browser-v1");
  assert.equal(broken.score.metrics.criticalMajorRecall, 1);
  assert.equal(broken.score.metrics.falsePositiveRate, 0);
  assert.equal(clean.score.metrics.confirmedCount, 0);

  for (const run of broken.runs) {
    for (const profile of run.profiles) await access(profile.screenshotPath);
  }
});