import { hasCompleteEvidence } from "./evidence.js";

export const REQUIRED_FLOW_IDS = [
  "first-load", "room-create", "room-join", "solo-start", "song-start", "answer-submit",
  "next-song", "duplicate-song", "refresh", "back", "invalid-input", "missing-route",
  "missing-api", "mobile-viewport", "runtime-errors", "cleanup",
];
export const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true },
};

export function buildPlan({ target, browser = "msedge", runs = 3 }) {
  const count = Number(runs);
  if (!Number.isInteger(count) || count < 1) throw new Error("runs must be a positive integer");
  if (typeof browser !== "string" || !browser.trim()) throw new Error("browser is required");
  const executions = [];
  for (let number = 1; number <= count; number += 1) {
    const runId = `run-${String(number).padStart(2, "0")}`;
    for (const [profile, options] of Object.entries(PROFILES)) executions.push({
      runId, browserSessionId: `${runId}-${browser}`,
      actorContextIds: Object.fromEntries(["solo", "host", "guest"].map((actor) =>
        [actor, `${runId}-${profile}-${actor}`])),
      profile, viewport: { ...options.viewport }, flowIds: [...REQUIRED_FLOW_IDS],
    });
  }
  return { target, browser, runs: count, executions };
}

export function summarize(runs, expectedRuns = 3) {
  const missing = [];
  const incompleteFindings = [];
  const ids = new Set();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run?.runId || ids.has(run.runId)) missing.push(`${run?.runId ?? "unknown"}:independent-run`);
    ids.add(run?.runId);
    for (const profile of Object.keys(PROFILES)) {
      const result = run?.profiles?.[profile];
      const completed = new Set(result?.completedFlowIds ?? []);
      for (const id of REQUIRED_FLOW_IDS) if (!completed.has(id)) missing.push(`${run?.runId ?? "unknown"}:${profile}:${id}`);
      for (const finding of result?.findings ?? []) if (!hasCompleteEvidence(finding)) {
        incompleteFindings.push(`${run?.runId ?? "unknown"}:${profile}:${finding?.signature ?? "unknown"}`);
      }
    }
  }
  if (!Array.isArray(runs) || runs.length !== expectedRuns) missing.push(`${expectedRuns}-independent-runs`);
  return { passed: !missing.length && !incompleteFindings.length,
    runCount: Array.isArray(runs) ? runs.length : 0, missing, incompleteFindings };
}

export function review(runs, { minimumConfirmations = 3 } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const grouped = new Map(); const rejected = [];
  for (const run of list) for (const profile of Object.values(run?.profiles ?? {})) {
    for (const finding of profile?.findings ?? []) {
      if (!hasCompleteEvidence(finding)) { rejected.push({ runId: run?.runId ?? null,
        signature: finding?.signature ?? null, reasons: ["confirmed finding evidence is incomplete"] }); continue; }
      const entries = grouped.get(finding.signature) ?? [];
      entries.push({ runId: run.runId, finding }); grouped.set(finding.signature, entries);
    }
  }
  const confirmed = []; const provisional = [];
  for (const [signature, entries] of grouped) {
    const representative = entries[0].finding;
    const count = new Set(entries.map(({ runId }) => runId)).size;
    const inconsistent = entries.some(({ finding }) => finding.severity !== representative.severity ||
      finding.title !== representative.title || finding.expected !== representative.expected ||
      finding.actual !== representative.actual || JSON.stringify(finding.reproduction) !== JSON.stringify(representative.reproduction));
    const item = { signature, severity: representative.severity, title: representative.title,
      reproduction: representative.reproduction, expected: representative.expected, actual: representative.actual,
      evidence: [{ type: "screenshot", detail: representative.screenshot }, ...representative.machineEvidence],
      confirmationCount: count, totalRuns: list.length, reproducibility: list.length ? count / list.length : null };
    if (inconsistent) { rejected.push({ runId: null, signature,
      reasons: ["confirmed finding actual or identity differs across runs"] }); provisional.push(item); }
    else (count >= minimumConfirmations ? confirmed : provisional).push(item);
  }
  return { runCount: list.length, confirmed, provisional, rejected };
}
