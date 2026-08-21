import test from "node:test";
import assert from "node:assert/strict";

const REQUIRED_FLOW_IDS = [
  "first-load",
  "room-create",
  "room-join",
  "solo-start",
  "song-start",
  "answer-submit",
  "next-song",
  "duplicate-song",
  "refresh",
  "back",
  "invalid-input",
  "missing-route",
  "missing-api",
  "mobile-viewport",
  "runtime-errors",
  "cleanup",
];

async function loadFlowRunner() {
  try {
    return await import("../src/benchmark/run-flow-browser.js");
  } catch {
    return null;
  }
}

test("flow browser benchmark exposes every required user flow", async () => {
  const runner = await loadFlowRunner();

  assert.ok(runner, "flow browser benchmark module must exist");
  assert.deepEqual(runner.REQUIRED_FLOW_IDS, REQUIRED_FLOW_IDS);
});

test("flow browser benchmark plans three independent desktop and mobile runs", async () => {
  const runner = await loadFlowRunner();

  assert.ok(runner, "flow browser benchmark module must exist");
  const plan = runner.buildFlowRunPlan({
    target: "https://songsong.jingyeong.cloud",
    browser: "msedge",
    runs: 3,
  });

  assert.equal(plan.executions.length, 6);
  assert.deepEqual(
    plan.executions.map(({ profile }) => profile),
    ["desktop", "mobile", "desktop", "mobile", "desktop", "mobile"],
  );
  assert.equal(new Set(plan.executions.map(({ browserSessionId }) => browserSessionId)).size, 3);
  assert.ok(plan.executions.every(({ flowIds }) =>
    REQUIRED_FLOW_IDS.every((flowId) => flowIds.includes(flowId))));
  assert.ok(plan.executions.every(({ actorContextIds }) =>
    new Set(Object.values(actorContextIds)).size === 3),
  "solo, host, and guest must use separate BrowserContexts");
});

test("flow result cannot pass with missing flow or incomplete confirmed evidence", async () => {
  const runner = await loadFlowRunner();

  assert.ok(runner, "flow browser benchmark module must exist");
  const completeEvidence = {
    reproduction: ["Open the page."],
    expected: "The page loads.",
    actual: "The page failed.",
    screenshot: "run-01/desktop/first-load.png",
    machineEvidence: [{ type: "assertion", detail: "status=500" }],
  };
  const runs = Array.from({ length: 3 }, (_, index) => ({
    runId: `run-${index + 1}`,
    profiles: {
      desktop: { completedFlowIds: REQUIRED_FLOW_IDS, findings: [] },
      mobile: { completedFlowIds: REQUIRED_FLOW_IDS, findings: [] },
    },
  }));

  assert.equal(runner.summarizeFlowRuns(runs).passed, true);

  runs[0].profiles.desktop.completedFlowIds = REQUIRED_FLOW_IDS.slice(1);
  assert.equal(runner.summarizeFlowRuns(runs).passed, false);

  runs[0].profiles.desktop.completedFlowIds = REQUIRED_FLOW_IDS;
  runs[0].profiles.desktop.findings = [{ signature: "browser:test", ...completeEvidence }];
  assert.equal(runner.summarizeFlowRuns(runs).passed, true);

  delete runs[0].profiles.desktop.findings[0].screenshot;
  assert.equal(runner.summarizeFlowRuns(runs).passed, false);
});

test("executed negative scenarios count as completed while preserving findings", async () => {
  const runner = await loadFlowRunner();

  assert.ok(runner, "flow browser benchmark module must exist");
  const runs = Array.from({ length: 3 }, (_, index) => ({
    runId: `run-${index + 1}`,
    profiles: {
      desktop: {
        completedFlowIds: REQUIRED_FLOW_IDS,
        findings: [{
          signature: "browser:soft-404:desktop",
          reproduction: ["GET /api/__vibecheck_missing__."],
          expected: "404 JSON.",
          actual: "200 text/html.",
          screenshot: "soft-404.png",
          machineEvidence: [{ type: "network", detail: "status=200" }],
        }],
      },
      mobile: { completedFlowIds: REQUIRED_FLOW_IDS, findings: [] },
    },
  }));

  const result = runner.summarizeFlowRuns(runs);
  assert.equal(result.passed, true);
  assert.equal(result.missing.length, 0);
});

test("flow reviewer confirms only complete findings reproduced in all three runs", async () => {
  const runner = await loadFlowRunner();

  assert.ok(runner, "flow browser benchmark module must exist");
  const finding = {
    signature: "flow:missing-api:desktop:failed",
    severity: "major",
    title: "Missing API returns the app shell",
    reproduction: ["GET /api/__vibecheck_missing__."],
    expected: "404 JSON.",
    actual: "200 text/html.",
    screenshot: "missing-api.png",
    machineEvidence: [{ type: "network", detail: "GET missing API -> 200 text/html" }],
  };
  const runs = Array.from({ length: 3 }, (_, index) => ({
    runId: `run-${index + 1}`,
    profiles: {
      desktop: { completedFlowIds: REQUIRED_FLOW_IDS, findings: [{ ...finding }] },
      mobile: { completedFlowIds: REQUIRED_FLOW_IDS, findings: [] },
    },
  }));

  const reviewed = runner.reviewFlowRuns(runs, { minimumConfirmations: 3 });
  assert.equal(reviewed.runCount, 3);
  assert.equal(reviewed.confirmed.length, 1);
  assert.equal(reviewed.confirmed[0].reproducibility, 1);
  assert.ok(reviewed.confirmed[0].evidence.some(({ type }) => type === "screenshot"));

  delete runs[2].profiles.desktop.findings[0].machineEvidence;
  const incomplete = runner.reviewFlowRuns(runs, { minimumConfirmations: 3 });
  assert.equal(incomplete.confirmed.length, 0);
  assert.equal(incomplete.rejected.length, 1);
});
