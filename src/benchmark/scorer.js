const IMPORTANT = new Set(["critical", "major"]);

export function scoreBenchmark(groundTruth, reviewed, gates = {}) {
  const gate = {
    criticalMajorRecall: 0.90,
    falsePositiveRate: 0.10,
    reproducibility: 0.95,
    ...gates,
  };

  const truthBySignature = new Map(
    groundTruth.issues.map((issue) => [issue.signature, issue])
  );
  const confirmedBySignature = new Map(
    reviewed.confirmed.map((finding) => [finding.signature, finding])
  );

  const truePositives = reviewed.confirmed.filter((finding) =>
    truthBySignature.has(finding.signature)
  );
  const falsePositives = reviewed.confirmed.filter(
    (finding) => !truthBySignature.has(finding.signature)
  );
  const falseNegatives = groundTruth.issues.filter(
    (issue) => !confirmedBySignature.has(issue.signature)
  );

  const importantTruth = groundTruth.issues.filter((issue) =>
    IMPORTANT.has(issue.severity)
  );
  const importantFound = importantTruth.filter((issue) =>
    confirmedBySignature.has(issue.signature)
  );

  const criticalMajorRecall =
    importantTruth.length === 0 ? 1 : importantFound.length / importantTruth.length;
  const falsePositiveRate =
    reviewed.confirmed.length === 0
      ? 0
      : falsePositives.length / reviewed.confirmed.length;
  const averageReproducibility =
    reviewed.confirmed.length === 0
      ? 1
      : reviewed.confirmed.reduce((sum, f) => sum + f.reproducibility, 0) /
        reviewed.confirmed.length;
  const reproducibility =
    reviewed.confirmed.length === 0
      ? 1
      : Math.min(...reviewed.confirmed.map((f) => f.reproducibility));

  const passed =
    criticalMajorRecall >= gate.criticalMajorRecall &&
    falsePositiveRate <= gate.falsePositiveRate &&
    reproducibility >= gate.reproducibility;

  return {
    passed,
    gates: gate,
    metrics: {
      criticalMajorRecall,
      falsePositiveRate,
      reproducibility,
      averageReproducibility,
      precision:
        reviewed.confirmed.length === 0
          ? 1
          : truePositives.length / reviewed.confirmed.length,
      truePositiveCount: truePositives.length,
      falsePositiveCount: falsePositives.length,
      falseNegativeCount: falseNegatives.length,
      confirmedCount: reviewed.confirmed.length,
      truthCount: groundTruth.issues.length,
    },
    truePositives: truePositives.map((f) => f.signature),
    falsePositives: falsePositives.map((f) => f.signature),
    falseNegatives: falseNegatives.map((f) => f.signature),
  };
}
