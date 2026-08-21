import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { FLOW_TRUST_MANIFEST } from "./manifest.js";

const EVIDENCE_TYPES = new Set(["network", "console", "screenshot", "assertion"]);
const STABLE_FIELDS = ["severity", "title", "reproduction", "expected", "actual"];

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function findingSlot(signature) {
  if (!nonempty(signature)) return null;
  const parts = signature.split(":");
  if (parts.length !== 4 || parts[0] !== "flow" || parts[3] !== "failed") return null;
  const flow = parts[1];
  const profile = parts[2];
  if (!FLOW_TRUST_MANIFEST.profiles.includes(profile) ||
      !FLOW_TRUST_MANIFEST.flows.includes(flow)) return null;
  return `${flow}:${profile}`;
}

function assertCompleteFinding(finding, runId, profile) {
  const label = `${runId}:${profile}:${finding?.signature ?? "unknown"}`;
  const slot = findingSlot(finding?.signature);
  const complete = finding && slot?.endsWith(`:${profile}`) &&
    nonempty(finding.severity) && nonempty(finding.title) &&
    Array.isArray(finding.reproduction) && finding.reproduction.length > 0 &&
    finding.reproduction.every(nonempty) && nonempty(finding.expected) &&
    nonempty(finding.actual) && nonempty(finding.screenshot) &&
    Array.isArray(finding.machineEvidence) && finding.machineEvidence.length > 0 &&
    finding.machineEvidence.every((item) => item && EVIDENCE_TYPES.has(item.type) && nonempty(item.detail));
  if (!complete) throw new Error(`Incomplete finding evidence: ${label}`);
}

async function validateScreenshot(screenshot, artifactRoot) {
  const root = await realpath(artifactRoot);
  const candidate = path.isAbsolute(screenshot) ? screenshot : path.resolve(root, screenshot);
  let canonical;
  let details;
  try {
    [canonical, details] = await Promise.all([realpath(candidate), stat(candidate)]);
  } catch {
    throw new Error(`Screenshot is missing: ${screenshot}`);
  }
  const relative = path.relative(root, canonical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Screenshot is outside raw artifacts: ${screenshot}`);
  }
  if (!details.isFile() || details.size === 0) {
    throw new Error(`Screenshot is empty: ${screenshot}`);
  }
  return canonical;
}

function reviewedFinding(signature, entries, runCount) {
  const representative = entries[0].finding;
  for (const { finding } of entries.slice(1)) {
    const mismatch = STABLE_FIELDS.find((field) =>
      JSON.stringify(finding[field]) !== JSON.stringify(representative[field]));
    if (mismatch) throw new Error(`Inconsistent repeated finding ${signature}: ${mismatch}`);
  }
  const confirmationCount = new Set(entries.map((entry) => entry.runId)).size;
  return {
    signature,
    severity: representative.severity,
    title: representative.title,
    reproduction: representative.reproduction,
    expected: representative.expected,
    actual: representative.actual,
    evidence: [
      { type: "screenshot", detail: representative.screenshot },
      ...representative.machineEvidence,
    ],
    confirmationCount,
    totalRuns: runCount,
    reproducibility: confirmationCount / runCount,
  };
}

export async function deriveRawReview(aggregate, artifactRoot) {
  if (aggregate?.passed !== true) throw new Error("Scanner aggregate must assert passed=true");
  if (!Array.isArray(aggregate.missing) || aggregate.missing.length !== 0) {
    throw new Error("Scanner aggregate missing list must be empty");
  }
  if (!Array.isArray(aggregate.incompleteFindings) || aggregate.incompleteFindings.length !== 0) {
    throw new Error("Scanner aggregate incompleteFindings list must be empty");
  }
  if (!Array.isArray(aggregate?.reviewed?.rejected) || aggregate.reviewed.rejected.length !== 0) {
    throw new Error("Raw reviewer rejected findings must be zero");
  }

  const runs = aggregate?.runs;
  if (!Array.isArray(runs) || runs.length !== FLOW_TRUST_MANIFEST.requiredRunCount) {
    throw new Error(`Exactly ${FLOW_TRUST_MANIFEST.requiredRunCount} raw runs are required`);
  }
  const runIds = new Set();
  const bySignature = new Map();
  for (const run of runs) {
    if (!nonempty(run?.runId)) throw new Error("Every raw run requires a run id");
    if (runIds.has(run.runId)) throw new Error(`Duplicate run id: ${run.runId}`);
    runIds.add(run.runId);
    for (const profile of FLOW_TRUST_MANIFEST.profiles) {
      const profileResult = run?.profiles?.[profile];
      if (!profileResult) throw new Error(`Missing required profile: ${run.runId}:${profile}`);
      const completed = new Set(Array.isArray(profileResult.completedFlowIds)
        ? profileResult.completedFlowIds : []);
      for (const flow of FLOW_TRUST_MANIFEST.flows) {
        if (!completed.has(flow)) {
          throw new Error(`Missing required flow ${flow}: ${run.runId}:${profile}`);
        }
      }
      if (!Array.isArray(profileResult.findings)) {
        throw new Error(`Findings must be an array: ${run.runId}:${profile}`);
      }
      const seen = new Set();
      for (const finding of profileResult.findings) {
        assertCompleteFinding(finding, run.runId, profile);
        if (seen.has(finding.signature)) {
          throw new Error(`Duplicate signature in ${run.runId}: ${finding.signature}`);
        }
        seen.add(finding.signature);
        await validateScreenshot(finding.screenshot, artifactRoot);
        const entries = bySignature.get(finding.signature) ?? [];
        entries.push({ runId: run.runId, finding });
        bySignature.set(finding.signature, entries);
      }
    }
  }

  const confirmed = [];
  const provisional = [];
  for (const [signature, entries] of bySignature) {
    const finding = reviewedFinding(signature, entries, runs.length);
    (finding.confirmationCount >= FLOW_TRUST_MANIFEST.minimumConfirmations
      ? confirmed : provisional).push(finding);
  }
  return { runCount: runs.length, confirmed, provisional, rejected: [] };
}

export function deriveNegativeOpportunityCount(groundTruth) {
  const issues = Array.isArray(groundTruth?.issues) ? groundTruth.issues : [];
  const truthSignatures = new Set();
  for (const issue of issues) {
    if (!findingSlot(issue?.signature)) {
      throw new Error(`Truth signature is outside trust manifest: ${issue?.signature ?? "unknown"}`);
    }
    if (truthSignatures.has(issue.signature)) {
      throw new Error(`Duplicate truth signature: ${issue.signature}`);
    }
    truthSignatures.add(issue.signature);
  }
  const uniqueSignatureSlots = FLOW_TRUST_MANIFEST.profiles.length * FLOW_TRUST_MANIFEST.flows.length;
  const knownPositiveCount = FLOW_TRUST_MANIFEST.knownPositiveSignatures.length;
  const count = uniqueSignatureSlots - knownPositiveCount;
  if (count <= 0) throw new Error("Trust manifest has no negative opportunities");
  return {
    count,
    formula: `${FLOW_TRUST_MANIFEST.profiles.length} profiles x ${FLOW_TRUST_MANIFEST.flows.length} flows - ${knownPositiveCount} manifest positive signatures = ${count} unique-signature negative opportunities`,
  };
}
