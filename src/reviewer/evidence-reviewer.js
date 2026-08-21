import { validateObservation } from "../domain/evidence.js";

const STABLE_IDENTITY_FIELDS = ["severity", "title", "reproduction", "expected"];

export function reviewRuns(runs, { minimumConfirmations = 2 } = {}) {
  const bySignature = new Map();
  const rejected = [];

  runs.forEach((run, runIndex) => {
    const seenThisRun = new Set();

    for (const finding of run.findings ?? []) {
      const validation = validateObservation(finding);
      if (!validation.ok) {
        rejected.push({
          runIndex,
          signature: finding?.signature ?? null,
          reasons: validation.errors,
        });
        continue;
      }

      if (
        finding.signature.startsWith("browser:") &&
        !finding.evidence.some((item) => item.type === "screenshot")
      ) {
        rejected.push({
          runIndex,
          signature: finding.signature,
          reasons: ["browser finding requires screenshot evidence"],
        });
        continue;
      }

      if (seenThisRun.has(finding.signature)) {
        rejected.push({
          runIndex,
          signature: finding.signature,
          reasons: ["duplicate signature in the same run"],
        });
        continue;
      }
      seenThisRun.add(finding.signature);

      const entries = bySignature.get(finding.signature) ?? [];
      entries.push({ runIndex, finding });
      bySignature.set(finding.signature, entries);
    }
  });

  const confirmed = [];
  const provisional = [];

  for (const [signature, entries] of bySignature.entries()) {
    const confirmationCount = entries.length;
    const reproducibility = runs.length === 0 ? 0 : confirmationCount / runs.length;
    const representative = entries[0].finding;
    const inconsistentFields = STABLE_IDENTITY_FIELDS.filter((field) =>
      entries.some((entry) => entry.finding[field] !== representative[field])
    );
    const result = {
      signature,
      severity: representative.severity,
      title: representative.title,
      reproduction: representative.reproduction,
      expected: representative.expected,
      actual: representative.actual,
      evidence: representative.evidence,
      confirmationCount,
      totalRuns: runs.length,
      reproducibility,
    };

    if (inconsistentFields.length > 0) {
      rejected.push({
        runIndex: null,
        signature,
        reasons: [`inconsistent repeated finding fields: ${inconsistentFields.join(", ")}`],
      });
      provisional.push({ ...result, inconsistentFields });
      continue;
    }

    if (confirmationCount >= minimumConfirmations) {
      confirmed.push(result);
    } else {
      provisional.push(result);
    }
  }

  return { confirmed, provisional, rejected };
}
