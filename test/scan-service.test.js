import test from "node:test";
import assert from "node:assert/strict";
import { createQuickScanService } from "../src/web/scan-service.js";

test("quick scan service preserves evidence-first confirmation and reports coverage", async () => {
  const calls = [];
  const runQuickScan = createQuickScanService({
    runCount: 3,
    maxPages: 2,
    authorize: async (target) => ({ origin: new URL(target).origin, hostname: new URL(target).hostname, allowPrivateForTesting: false }),
    explore: async (target, options) => {
      calls.push(["explore", target, options.maxPages]);
      return {
        target,
        origin: new URL(target).origin,
        pageCount: 2,
        coverage: { discoveredSafeLinks: 3, skippedRiskyLinks: 1, formsObserved: 1, buttonsObserved: 2 },
        pages: [
          { url: target, title: "Home", forms: [], buttons: [{ text: "Go", type: "button", disabled: false }], links: [target + "about"], skippedRiskyLinks: [], consoleErrors: [], badResponses: [] },
          { url: target + "about", title: "About", forms: [], buttons: [], links: [], skippedRiskyLinks: [], consoleErrors: [], badResponses: [] },
        ],
      };
    },
    scan: async (target, options) => {
      calls.push(["scan", target, options.targetPolicy.origin]);
      return {
        baseUrl: target,
        findings: [{
          signature: "browser:console-error:desktop",
          severity: "major",
          title: "Browser console error on desktop",
          reproduction: "Open the page.",
          expected: "No application console errors.",
          actual: "ReferenceError observed.",
          evidence: [{ type: "console", detail: "ReferenceError: x is not defined" }, { type: "screenshot", detail: "shot.png" }],
        }],
      };
    },
    review: (runs) => ({
      confirmed: [{ ...runs[0].findings[0], confirmationCount: 3, totalRuns: 3 }],
      provisional: [],
      rejected: [],
    }),
    discoveryAdapter: {
      async discover() {
        return [{ action: "click", selector: "button", expectation: "Button should change state.", rationale: "Primary control exists.", confidence: 0.7 }];
      },
    },
  });

  const progress = [];
  const result = await runQuickScan("https://example.com/", { scanId: "test-scan", onProgress: (event) => progress.push(event) });
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 3);
  assert.equal(result.report.summary.confirmed, 1);
  assert.equal(result.report.confirmed[0].confirmationCount, 3);
  assert.equal(result.report.coverage.pagesVisited, 2);
  assert.equal(result.report.coverage.aiDiscoveryCandidates, 1);
  assert.equal(result.discovery[0].status, "candidate");
  assert.equal("confirmed" in result.discovery[0], false);
  assert.match(result.reportHtml, /Browser console error on desktop/);
  assert.ok(progress.some((event) => event.stage === "review"));
  assert.ok(progress.some((event) => event.stage === "report"));
});
