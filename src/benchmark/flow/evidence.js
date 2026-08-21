import { access } from "node:fs/promises";
import path from "node:path";
const TYPES = new Set(["assertion", "network", "console", "screenshot"]);
const STRINGS = ["signature", "severity", "title", "expected", "actual"];

function withinRoot(root, reference) {
  const absolute = path.resolve(root, reference);
  const relative = path.relative(path.resolve(root), absolute);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? absolute : null;
}

export async function validateFinding(finding, { artifactRoot }) {
  if (!finding || STRINGS.some((key) => typeof finding[key] !== "string" || !finding[key])) {
    throw new Error("finding identity and outcome must be non-empty strings");
  }
  if (!Array.isArray(finding.reproduction) || !finding.reproduction.length ||
      finding.reproduction.some((item) => typeof item !== "string" || !item)) {
    throw new Error("finding reproduction must contain strings");
  }
  if (!Array.isArray(finding.machineEvidence) || !finding.machineEvidence.length) {
    throw new Error("finding requires machine evidence");
  }
  for (const item of finding.machineEvidence) {
    if (!item || !TYPES.has(item.type)) throw new Error("unknown evidence type");
    if (typeof item.detail !== "string" || !item.detail) throw new Error("evidence detail must be a string");
  }
  if (typeof finding.screenshot !== "string" || !finding.screenshot) throw new Error("finding requires screenshot reference");
  const screenshot = withinRoot(artifactRoot, finding.screenshot);
  if (!screenshot) throw new Error("screenshot reference is outside artifact root");
  try { await access(screenshot); } catch { throw new Error("screenshot reference is missing"); }
  return finding;
}

function sameIdentity(left, right) {
  return left.title === right.title && left.severity === right.severity && left.expected === right.expected &&
    JSON.stringify(left.reproduction) === JSON.stringify(right.reproduction);
}

export async function validateRunFindings(findings, { artifactRoot, identities = new Map() }) {
  const seen = new Set();
  for (const finding of findings) {
    await validateFinding(finding, { artifactRoot });
    if (seen.has(finding.signature)) throw new Error("duplicate finding signature in one run");
    seen.add(finding.signature);
    const prior = identities.get(finding.signature);
    if (prior && !sameIdentity(prior, finding)) throw new Error("inconsistent finding reproduction or identity");
    if (!prior) identities.set(finding.signature, finding);
  }
  return identities;
}

export function hasCompleteEvidence(finding) {
  return Boolean(finding && ["signature", "expected", "actual"].every((key) =>
    typeof finding[key] === "string" && finding[key]) &&
    Array.isArray(finding.reproduction) && finding.reproduction.length &&
    typeof finding.screenshot === "string" && finding.screenshot && Array.isArray(finding.machineEvidence) &&
    finding.machineEvidence.length && finding.machineEvidence.every((item) =>
      TYPES.has(item?.type) && typeof item.detail === "string" && item.detail));
}
