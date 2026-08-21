function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function impactForSeverity(severity) {
  return {
    critical: "Likely blocks launch or exposes high-impact user/business risk.",
    major: "Likely degrades a core user journey or launch quality.",
    minor: "Limited user impact, polish issue, or non-core operational noise.",
  }[severity] ?? "Verified issue requiring triage.";
}

function fixHintFor(item) {
  const signature = item.signature ?? "";
  if (/horizontal-overflow/u.test(signature)) return "Inspect fixed/min-width layout constraints at the failing viewport and remove unintended horizontal overflow.";
  if (/http:/u.test(signature)) return "Trace the failing request from the recorded network evidence and restore or intentionally remove the referenced resource/route.";
  if (/console|page-error/u.test(signature)) return "Reproduce with the recorded steps, inspect the captured console/runtime error, and fix the first application-owned stack or message.";
  return "Reproduce from the recorded steps and fix the smallest application behavior that makes actual match expected; rerun VibeCheck to verify.";
}

function normalizeFinding(item, status) {
  const totalRuns = Number.isInteger(item.totalRuns) && item.totalRuns > 0 ? item.totalRuns : 1;
  const confirmationCount = Number.isInteger(item.confirmationCount) ? item.confirmationCount : 0;
  return {
    status,
    signature: item.signature,
    severity: item.severity ?? "unknown",
    title: item.title ?? item.signature ?? "Untitled finding",
    confirmationCount,
    totalRuns,
    reproductionRate: confirmationCount / totalRuns,
    reproduction: item.reproduction ?? null,
    expected: item.expected ?? null,
    actual: item.actual ?? null,
    evidence: Array.isArray(item.evidence) ? structuredClone(item.evidence) : [],
    impact: impactForSeverity(item.severity),
    fixHint: fixHintFor(item),
  };
}

export function buildCustomerReport({ target, reviewed, scanMeta = {} }) {
  if (!target) throw new Error("target is required");
  if (!reviewed || !Array.isArray(reviewed.confirmed) || !Array.isArray(reviewed.provisional)) {
    throw new Error("reviewed findings are required");
  }

  const confirmed = reviewed.confirmed.map((item) => normalizeFinding(item, "confirmed"));
  const provisional = reviewed.provisional.map((item) => normalizeFinding(item, "provisional"));
  const counts = { critical: 0, major: 0, minor: 0, unknown: 0 };
  for (const item of confirmed) counts[item.severity in counts ? item.severity : "unknown"] += 1;

  return {
    schemaVersion: 1,
    target,
    generatedAt: scanMeta.generatedAt ?? new Date().toISOString(),
    runCount: scanMeta.runCount ?? null,
    coverage: scanMeta.coverage ?? null,
    summary: {
      confirmed: confirmed.length,
      provisional: provisional.length,
      bySeverity: counts,
    },
    confirmed,
    provisional,
  };
}

export function renderCustomerReportHtml(report) {
  const findingHtml = report.confirmed.length === 0
    ? '<p class="empty">No confirmed findings in this scan scope.</p>'
    : report.confirmed.map((item) => `
      <article class="finding">
        <div class="finding-head"><span class="sev ${esc(item.severity)}">${esc(item.severity.toUpperCase())}</span><h3>${esc(item.title)}</h3></div>
        <p><strong>Reproduced:</strong> ${item.confirmationCount}/${item.totalRuns} (${pct(item.reproductionRate)})</p>
        <p><strong>Expected:</strong> ${esc(item.expected ?? "Not recorded")}</p>
        <p><strong>Actual:</strong> ${esc(item.actual ?? "Not recorded")}</p>
        <p><strong>Impact:</strong> ${esc(item.impact)}</p>
        <p><strong>Fix hint:</strong> ${esc(item.fixHint)}</p>
        <details><summary>Evidence (${item.evidence.length})</summary><ul>${item.evidence.map((e) => `<li><code>${esc(e.type)}</code> ${esc(e.detail)}</li>`).join("")}</ul></details>
      </article>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeCheck result</title><style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:980px;margin:0 auto;padding:32px;background:#0b0d10;color:#f5f7fa}.card,.finding{background:#151922;border:1px solid #2a3040;border-radius:16px;padding:20px;margin:16px 0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.metric{background:#11151d;padding:16px;border-radius:12px}.metric b{font-size:28px;display:block}.finding-head{display:flex;gap:10px;align-items:center}.finding-head h3{margin:0}.sev{font-size:12px;font-weight:800;padding:5px 8px;border-radius:999px;background:#2a3040}.critical{background:#6b1d1d}.major{background:#6b471d}.minor{background:#244b70}code{white-space:pre-wrap;word-break:break-word}.muted{color:#9da7b5}.empty{color:#9da7b5}</style></head><body>
  <h1>VibeCheck</h1><p class="muted">Evidence-first launch QA</p>
  <section class="card"><h2>${esc(report.target)}</h2><div class="summary"><div class="metric"><b>${report.summary.confirmed}</b>Confirmed</div><div class="metric"><b>${report.summary.bySeverity.critical}</b>Critical</div><div class="metric"><b>${report.summary.bySeverity.major}</b>Major</div><div class="metric"><b>${report.summary.bySeverity.minor}</b>Minor</div></div></section>
  <h2>Confirmed findings</h2>${findingHtml}
  ${report.provisional.length ? `<h2>Needs more evidence</h2><p class="muted">${report.provisional.length} provisional observation(s) were not promoted to confirmed findings.</p>` : ""}
  </body></html>`;
}
