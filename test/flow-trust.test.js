import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFlowTrust } from "../src/benchmark/run-flow-trust.js";

const FLOWS = [
  "first-load", "room-create", "room-join", "solo-start", "song-start",
  "answer-submit", "next-song", "duplicate-song", "refresh", "back",
  "invalid-input", "missing-route", "missing-api", "mobile-viewport", "runtime-errors", "cleanup",
];
const PROFILES = ["desktop", "mobile"];
const KNOWN = "flow:missing-route:desktop:failed";

function rawFinding(signature, profile, screenshot, overrides = {}) {
  return { signature, severity: "major", title: `Finding ${signature}`,
    reproduction: ["Run the deterministic browser flow."], expected: "The flow succeeds.",
    actual: "The flow failed.", screenshot,
    machineEvidence: [{ type: "assertion", detail: `profile=${profile}` }], ...overrides };
}

function cleanControl(overrides = {}) {
  return { fixture: "clean-browser-v1", runCount: 3, passed: true,
    runs: [{ findings: [] }, { findings: [] }, { findings: [] }],
    reviewed: { confirmed: [], provisional: [], rejected: [] },
    evidencePath: "trust-clean-control", ...overrides };
}

async function fixture({ signaturesByRun = [[KNOWN], [KNOWN], [KNOWN]],
  mutateAggregate = (aggregate) => aggregate, mutateFinding = (finding) => finding,
  truthIssues = [{ signature: KNOWN, severity: "major" }] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-trust-"));
  const input = path.join(root, "scanner");
  await mkdir(input, { recursive: true });
  const runs = [];
  for (let runIndex = 0; runIndex < 3; runIndex += 1) {
    const runId = `run-${String(runIndex + 1).padStart(2, "0")}`;
    const profiles = {};
    for (const profile of PROFILES) {
      const findings = [];
      for (const [findingIndex, signature] of (signaturesByRun[runIndex] ?? []).entries()) {
        if (signature.split(":")[2] !== profile) continue;
        const screenshot = path.join(input, runId, profile, `${findingIndex + 1}.png`);
        await mkdir(path.dirname(screenshot), { recursive: true });
        await writeFile(screenshot, "png");
        findings.push(mutateFinding(rawFinding(signature, profile, screenshot), { runIndex, profile }));
      }
      profiles[profile] = { completedFlowIds: [...FLOWS], findings };
    }
    runs.push({ runId, profiles });
  }
  const aggregate = mutateAggregate({ passed: true, runCount: 3, missing: [], incompleteFindings: [],
    reviewed: { runCount: 3, confirmed: [], provisional: [], rejected: [] },
    negativeOpportunities: 1_000_000, cleanControlConfirmed: [],
    cleanControlFixtureReference: "forged-empty-control", runs });
  await writeFile(path.join(input, "aggregate.json"), JSON.stringify(aggregate));
  const groundTruth = path.join(root, "truth.json");
  await writeFile(groundTruth, JSON.stringify({ issues: truthIssues }));
  return { input, groundTruth, output: path.join(root, "nested", "reports", "trust.json") };
}

const execute = (paths, control = cleanControl()) =>
  runFlowTrust(paths, { executeCleanControl: async ({ evidencePath }) =>
    control && { ...control, evidencePath } });

test("rejects forged 1,000,000 denominator and scanner-authored empty clean control", async () => {
  const falseSignatures = ["flow:first-load:desktop:failed",
    "flow:room-create:desktop:failed", "flow:room-join:desktop:failed"];
  const paths = await fixture({ signaturesByRun: Array.from({ length: 3 }, () => [KNOWN, ...falseSignatures]) });
  await assert.rejects(execute(paths, null), /clean control/i);
  const report = await execute(paths);
  assert.equal(report.metrics.negativeOpportunityCount, 28);
  assert.equal(report.metrics.falsePositiveCount, 3);
  assert.equal(report.passed, false);
});

test("derives missing flow, incomplete evidence, and raw reviewer rejection", async (t) => {
  await t.test("missing flow", async () => {
    const paths = await fixture({ mutateAggregate(a) { a.runs[1].profiles.mobile.completedFlowIds.pop(); return a; } });
    await assert.rejects(execute(paths), /missing required flow.*cleanup/i);
  });
  await t.test("incomplete evidence", async () => {
    const paths = await fixture({ mutateFinding(f, { runIndex }) { return runIndex === 1 ? { ...f, actual: "" } : f; } });
    await assert.rejects(execute(paths), /incomplete finding evidence/i);
  });
  await t.test("rejected finding", async () => {
    const paths = await fixture({ mutateAggregate(a) { a.reviewed.rejected.push({ signature: KNOWN }); return a; } });
    await assert.rejects(execute(paths), /raw reviewer rejected/i);
  });
});

test("rejects duplicate signature and repeated-run dilution", async (t) => {
  const duplicate = await fixture({ signaturesByRun: [[KNOWN, KNOWN], [KNOWN], [KNOWN]] });
  await assert.rejects(execute(duplicate), /duplicate signature.*run-01/i);
  const repeated = await fixture({ mutateAggregate(a) { a.runs[2].runId = a.runs[1].runId; return a; } });
  await assert.rejects(execute(repeated), /duplicate run id/i);
});

test("scores 2/3 reproducibility while 1/3 remains provisional", async () => {
  const once = "flow:room-create:mobile:failed";
  const report = await execute(await fixture({ signaturesByRun: [[KNOWN, once], [KNOWN], []] }));
  assert.equal(report.metrics.runCount, 3);
  assert.equal(report.metrics.reproducibility, 2 / 3);
  assert.equal(report.score.truePositives.length, 1);
  assert.equal(report.score.falsePositives.includes(once), false);
  assert.equal(report.reviewed.provisional.some((finding) => finding.signature === once), true);
  assert.equal(report.passed, false);
});

test("validates screenshot and independent clean control identity/result", async () => {
  const missing = await fixture({ mutateFinding(f, { runIndex }) {
    return runIndex === 0 ? { ...f, screenshot: `${f.screenshot}.missing` } : f; } });
  await assert.rejects(execute(missing), /screenshot.*missing|missing.*screenshot/i);
  const paths = await fixture();
  await assert.rejects(execute(paths, cleanControl({ fixture: "broken-browser-v1" })), /clean control fixture/i);
  await assert.rejects(execute(paths, cleanControl({ passed: false })), /clean control failed/i);
});

test("supports exact directory input, creates output parent, and derives isolation proof", async () => {
  const paths = await fixture();
  const report = await execute(paths);
  assert.equal(JSON.parse(await readFile(paths.output, "utf8")).passed, true);
  assert.match(report.hashes.scannerAggregate, /^[a-f0-9]{64}$/u);
  assert.match(report.hashes.groundTruth, /^[a-f0-9]{64}$/u);
  assert.equal(report.isolationProof.scannerAggregateLoadedBeforeGroundTruth, true);
  assert.equal(report.isolationProof.scannerAggregateHashStable, true);
  assert.equal(report.isolationProof.scannerImportsGroundTruth, false);
  assert.ok(report.isolationProof.scannerModuleImports.length > 0);
  assert.deepEqual(report.isolationProof.callOrder.slice(0, 2),
    ["load-and-seal-scanner-aggregate", "execute-clean-control"]);
});
