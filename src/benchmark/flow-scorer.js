const IMPORTANT_SEVERITIES = new Set(["critical", "major"]);

const GATES = Object.freeze({
  minimumRunCount: 3,
  criticalMajorRecall: 0.9,
  falsePositiveRate: 0.1,
  reproducibility: 0.95,
  cleanControlCriticalMajorFalsePositiveCount: 0,
  evidenceLessConfirmedCount: 0,
});

function list(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function indexTruth(issues) {
  const truthBySignature = new Map();
  for (const issue of issues) {
    if (truthBySignature.has(issue.signature)) {
      throw new Error(`Duplicate truth signature: ${issue.signature}`);
    }
    truthBySignature.set(issue.signature, issue);
  }
  return truthBySignature;
}

/**
 * Scores a scanner aggregate without giving the scanner access to benchmark truth.
 * The third argument contains predeclared negative opportunities and clean controls.
 */
export function scoreFlowBenchmark(groundTruth, reviewed, controls = {}) {
  const truth = list(groundTruth?.issues);
  const confirmed = list(reviewed?.confirmed);
  const cleanControlConfirmed = Array.isArray(controls.cleanControlConfirmed)
    ? controls.cleanControlConfirmed
    : null;
  const truthBySignature = indexTruth(truth);
  const confirmedBySignature = new Map();

  for (const finding of confirmed) {
    if (confirmedBySignature.has(finding.signature)) {
      throw new Error(`Duplicate confirmed signature: ${finding.signature}`);
    }
    confirmedBySignature.set(finding.signature, finding);
  }

  const severityMismatches = confirmed.filter((finding) => {
    const expected = truthBySignature.get(finding.signature);
    return expected && expected.severity !== finding.severity;
  });
  const exactMatches = confirmed.filter((finding) => {
    const expected = truthBySignature.get(finding.signature);
    return expected && expected.severity === finding.severity;
  });
  const falseDiscoveries = confirmed.filter(
    (finding) => !truthBySignature.has(finding.signature)
  );
  const falseNegatives = truth.filter((issue) => {
    const finding = confirmedBySignature.get(issue.signature);
    return !finding || finding.severity !== issue.severity;
  });
  const importantTruth = truth.filter((issue) =>
    IMPORTANT_SEVERITIES.has(issue.severity)
  );
  const importantExactMatches = importantTruth.filter((issue) => {
    const finding = confirmedBySignature.get(issue.signature);
    return finding && finding.severity === issue.severity;
  });
  const negativeOpportunities = controls.negativeOpportunities;
  const hasNegativeOpportunities =
    finiteNumber(negativeOpportunities) && negativeOpportunities > 0;
  const reproducibilityValues = confirmed.map((finding) => finding.reproducibility);
  const hasReproducibilitySample =
    reproducibilityValues.length > 0 && reproducibilityValues.every(finiteNumber);
  const evidenceLessConfirmed = confirmed.filter(
    (finding) => !Array.isArray(finding.evidence) || finding.evidence.length === 0
  );
  const cleanControlCriticalMajorFalsePositives = cleanControlConfirmed
    ? cleanControlConfirmed.filter((finding) => IMPORTANT_SEVERITIES.has(finding.severity))
    : [];

  const criticalMajorRecall =
    importantTruth.length > 0
      ? importantExactMatches.length / importantTruth.length
      : null;
  const falsePositiveRate = hasNegativeOpportunities
    ? falseDiscoveries.length / negativeOpportunities
    : null;
  const falseDiscoveryRate =
    confirmed.length > 0 ? falseDiscoveries.length / confirmed.length : null;
  const reproducibility = hasReproducibilitySample
    ? Math.min(...reproducibilityValues)
    : null;
  const averageReproducibility = hasReproducibilitySample
    ? reproducibilityValues.reduce((total, value) => total + value, 0) /
      reproducibilityValues.length
    : null;
  const runCount = reviewed?.runCount;

  const metrics = {
    runCount: finiteNumber(runCount) ? runCount : null,
    criticalMajorRecall,
    falsePositiveRate,
    falseDiscoveryRate,
    reproducibility,
    averageReproducibility,
    truePositiveCount: exactMatches.length,
    falsePositiveCount: falseDiscoveries.length,
    falseDiscoveryCount: falseDiscoveries.length,
    falseNegativeCount: falseNegatives.length,
    severityMismatchCount: severityMismatches.length,
    evidenceLessConfirmedCount: evidenceLessConfirmed.length,
    cleanControlCriticalMajorFalsePositiveCount: cleanControlConfirmed
      ? cleanControlCriticalMajorFalsePositives.length
      : null,
    confirmedCount: confirmed.length,
    truthCount: truth.length,
    importantTruthCount: importantTruth.length,
    negativeOpportunityCount: hasNegativeOpportunities ? negativeOpportunities : null,
  };

  const passed =
    Number.isInteger(runCount) &&
    runCount >= GATES.minimumRunCount &&
    criticalMajorRecall !== null &&
    criticalMajorRecall >= GATES.criticalMajorRecall &&
    falsePositiveRate !== null &&
    falsePositiveRate <= GATES.falsePositiveRate &&
    reproducibility !== null &&
    reproducibility >= GATES.reproducibility &&
    severityMismatches.length === 0 &&
    evidenceLessConfirmed.length === GATES.evidenceLessConfirmedCount &&
    cleanControlConfirmed !== null &&
    cleanControlCriticalMajorFalsePositives.length ===
      GATES.cleanControlCriticalMajorFalsePositiveCount;

  return {
    passed,
    gates: GATES,
    metrics,
    truePositives: exactMatches.map((finding) => finding.signature),
    falsePositives: falseDiscoveries.map((finding) => finding.signature),
    falseDiscoveries: falseDiscoveries.map((finding) => finding.signature),
    falseNegatives: falseNegatives.map((issue) => issue.signature),
    severityMismatches: severityMismatches.map((finding) => finding.signature),
    evidenceLessConfirmed: evidenceLessConfirmed.map((finding) => finding.signature),
    cleanControlCriticalMajorFalsePositives:
      cleanControlCriticalMajorFalsePositives.map((finding) => finding.signature),
  };
}
