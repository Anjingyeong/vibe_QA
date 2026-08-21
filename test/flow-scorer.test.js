import test from "node:test";
import assert from "node:assert/strict";

async function loadFlowScorer() {
  try {
    return await import("../src/benchmark/flow-scorer.js");
  } catch {
    return null;
  }
}

function confirmed(signature, severity, reproducibility = 1) {
  return {
    signature,
    severity,
    reproducibility,
    evidence: [{ type: "assertion", detail: "machine assertion" }],
  };
}

test("flow scorer fails severity mismatches and uses predeclared negative opportunities", async () => {
  const scorer = await loadFlowScorer();

  assert.ok(scorer, "flow scorer module must exist");
  const result = scorer.scoreFlowBenchmark(
    { issues: [{ signature: "known", severity: "critical" }] },
    { runCount: 3, confirmed: [confirmed("known", "minor"), confirmed("unknown", "major")] },
    { negativeOpportunities: 20, cleanControlConfirmed: [] },
  );

  assert.equal(result.metrics.criticalMajorRecall, 0);
  assert.equal(result.metrics.falsePositiveRate, 1 / 20);
  assert.equal(result.metrics.falseDiscoveryRate, 1 / 2);
  assert.equal(result.metrics.severityMismatchCount, 1);
  assert.equal(result.passed, false);
});

test("flow scorer treats no runs and evidence-less confirmations as gate failures", async () => {
  const scorer = await loadFlowScorer();

  assert.ok(scorer, "flow scorer module must exist");
  const noRuns = scorer.scoreFlowBenchmark(
    { issues: [] },
    { runCount: 0, confirmed: [] },
    { negativeOpportunities: 10, cleanControlConfirmed: [] },
  );
  assert.equal(noRuns.metrics.reproducibility, null);
  assert.equal(noRuns.passed, false);

  const evidenceLess = scorer.scoreFlowBenchmark(
    { issues: [] },
    {
      runCount: 3,
      confirmed: [{ signature: "unsupported", severity: "major", reproducibility: 1, evidence: [] }],
    },
    { negativeOpportunities: 10, cleanControlConfirmed: [] },
  );
  assert.equal(evidenceLess.metrics.evidenceLessConfirmedCount, 1);
  assert.equal(evidenceLess.passed, false);
});

test("flow scorer exposes clean-control critical and major false positives", async () => {
  const scorer = await loadFlowScorer();

  assert.ok(scorer, "flow scorer module must exist");
  const result = scorer.scoreFlowBenchmark(
    { issues: [] },
    { runCount: 3, confirmed: [] },
    {
      negativeOpportunities: 10,
      cleanControlConfirmed: [confirmed("clean-noise", "major")],
    },
  );

  assert.equal(result.metrics.cleanControlCriticalMajorFalsePositiveCount, 1);
  assert.equal(result.passed, false);
});


test("flow scorer rejects duplicate truth and duplicate confirmed signatures", async () => {
  const scorer = await loadFlowScorer();

  assert.ok(scorer, "flow scorer module must exist");
  assert.throws(
    () => scorer.scoreFlowBenchmark(
      { issues: [
        { signature: "known", severity: "major" },
        { signature: "known", severity: "major" },
      ] },
      { runCount: 3, confirmed: [] },
      { negativeOpportunities: 10, cleanControlConfirmed: [] },
    ),
    /Duplicate truth signature: known/,
  );
  assert.throws(
    () => scorer.scoreFlowBenchmark(
      { issues: [{ signature: "known", severity: "major" }] },
      { runCount: 3, confirmed: [confirmed("known", "major"), confirmed("known", "major")] },
      { negativeOpportunities: 10, cleanControlConfirmed: [] },
    ),
    /Duplicate confirmed signature: known/,
  );
});
