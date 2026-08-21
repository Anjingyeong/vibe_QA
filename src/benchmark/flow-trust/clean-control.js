import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startBrowserFixtureServer } from "../../fixture/browser-server.js";
import { scanBrowser } from "../../scanner/browser-scanner.js";
import { reviewRuns } from "../../reviewer/evidence-reviewer.js";
import { FLOW_TRUST_MANIFEST } from "./manifest.js";

const IMPORTANT = new Set(["critical", "major"]);

export async function executeBrowserCleanControl({ evidencePath }) {
  await mkdir(evidencePath, { recursive: true });
  const fixture = await startBrowserFixtureServer(FLOW_TRUST_MANIFEST.cleanControl.fixture, 0);
  const runs = [];
  try {
    for (let index = 0; index < FLOW_TRUST_MANIFEST.cleanControl.runCount; index += 1) {
      runs.push(await scanBrowser(fixture.baseUrl, {
        screenshotDir: path.join(evidencePath, `run-${index + 1}`),
      }));
    }
  } finally {
    await fixture.close();
  }
  const reviewed = reviewRuns(runs, {
    minimumConfirmations: FLOW_TRUST_MANIFEST.minimumConfirmations,
  });
  const failed = reviewed.rejected.length > 0 ||
    reviewed.confirmed.some((finding) => IMPORTANT.has(finding.severity));
  return { fixture: FLOW_TRUST_MANIFEST.cleanControl.fixture, runCount: runs.length,
    passed: !failed, runs, reviewed, evidencePath };
}

export function validateCleanControl(control, expectedEvidencePath) {
  if (!control || typeof control !== "object") throw new Error("Clean control is absent");
  if (control.fixture !== FLOW_TRUST_MANIFEST.cleanControl.fixture) {
    throw new Error(`Clean control fixture mismatch: ${control.fixture ?? "absent"}`);
  }
  if (!Array.isArray(control.runs) ||
      control.runs.length !== FLOW_TRUST_MANIFEST.cleanControl.runCount) {
    throw new Error("Clean control run count mismatch");
  }
  const reviewed = reviewRuns(control.runs, {
    minimumConfirmations: FLOW_TRUST_MANIFEST.minimumConfirmations,
  });
  const failed = control.passed !== true || reviewed.rejected.length > 0 ||
    reviewed.confirmed.some((finding) => IMPORTANT.has(finding.severity));
  if (failed) throw new Error("Clean control failed");
  if (path.resolve(control.evidencePath ?? "") !== path.resolve(expectedEvidencePath)) {
    throw new Error("Clean control evidence path mismatch");
  }
  return { ...control, runCount: control.runs.length, reviewed };
}
