import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerReport, renderCustomerReportHtml } from "../src/report/customer-report.js";

test("customer report preserves evidence and separates provisional findings", () => {
  const reviewed = {
    confirmed: [{
      signature: "browser:horizontal-overflow:mobile",
      severity: "major",
      title: "Horizontal overflow on mobile",
      reproduction: "Open at 390px.",
      expected: "No horizontal scroll.",
      actual: "scrollWidth=922 clientWidth=390",
      evidence: [{ type: "assertion", detail: "scrollWidth=922, clientWidth=390" }],
      confirmationCount: 3,
      totalRuns: 3,
    }],
    provisional: [{
      signature: "browser:console-error:desktop",
      severity: "minor",
      title: "Intermittent console noise",
      reproduction: "Open the page.",
      expected: "No noise.",
      actual: "Observed once.",
      evidence: [{ type: "console", detail: "noise" }],
      confirmationCount: 1,
      totalRuns: 3,
    }],
  };

  const report = buildCustomerReport({ target: "https://example.com", reviewed, scanMeta: { runCount: 3, generatedAt: "2026-08-21T00:00:00.000Z" } });
  assert.equal(report.summary.confirmed, 1);
  assert.equal(report.summary.provisional, 1);
  assert.equal(report.summary.bySeverity.major, 1);
  assert.equal(report.confirmed[0].reproductionRate, 1);
  assert.deepEqual(report.confirmed[0].evidence, reviewed.confirmed[0].evidence);
  assert.match(report.confirmed[0].fixHint, /overflow/i);
});

test("customer report HTML escapes target and evidence content", () => {
  const report = buildCustomerReport({
    target: "https://example.com/<script>",
    reviewed: {
      confirmed: [{
        signature: "browser:console-error:desktop",
        severity: "major",
        title: "<img src=x onerror=alert(1)>",
        reproduction: "Open page.",
        expected: "No errors.",
        actual: "Error occurred.",
        evidence: [{ type: "console", detail: "<script>alert(1)</script>" }],
        confirmationCount: 3,
        totalRuns: 3,
      }],
      provisional: [],
    },
  });
  const html = renderCustomerReportHtml(report);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;script&gt;/);
});

test("customer report renders a clear Korean zero-finding state without overclaiming", () => {
  const report = buildCustomerReport({ target: "https://example.com", reviewed: { confirmed: [], provisional: [] } });
  const html = renderCustomerReportHtml(report);
  assert.match(html, /검사가 완료됐습니다/);
  assert.match(html, /확정된 문제를 찾지 못했습니다/);
  assert.match(html, /모든 문제가 없음을 보장하는 결과는 아닙니다/);
  assert.match(html, />확정</);
  assert.match(html, /<h2>확정된 문제<\/h2>/);
});

test("customer report refuses missing reviewer output", () => {
  assert.throws(() => buildCustomerReport({ target: "https://example.com", reviewed: null }), /reviewed findings are required/);
});
