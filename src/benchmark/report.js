function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderMarkdownReport({ score, reviewed, runCount }) {
  const lines = [
    "# VibeCheck benchmark report",
    "",
    `- Result: **${score.passed ? "PASS" : "FAIL"}**`,
    `- Independent runs: **${runCount}**`,
    `- Critical/Major recall: **${pct(score.metrics.criticalMajorRecall)}** (gate ${pct(score.gates.criticalMajorRecall)})`,
    `- False-positive rate: **${pct(score.metrics.falsePositiveRate)}** (gate <= ${pct(score.gates.falsePositiveRate)})`,
    `- Reproducibility: **${pct(score.metrics.reproducibility)}** (gate ${pct(score.gates.reproducibility)})`,
    `- Precision: **${pct(score.metrics.precision)}**`,
    "",
    "## Confirmed findings",
    "",
  ];

  for (const item of reviewed.confirmed) {
    lines.push(
      `### ${item.severity.toUpperCase()} — ${item.title}`,
      "",
      `- Signature: \`${item.signature}\``,
      `- Reproduced: ${item.confirmationCount}/${item.totalRuns}`,
      `- Steps: ${item.reproduction}`,
      `- Expected: ${item.expected}`,
      `- Actual: ${item.actual}`,
      `- Evidence: ${item.evidence.map((e) => `${e.type}: ${e.detail}`).join("; ")}`,
      ""
    );
  }

  if (reviewed.provisional.length > 0) {
    lines.push("## Provisional findings", "");
    for (const item of reviewed.provisional) {
      lines.push(`- ${item.signature} (${item.confirmationCount}/${item.totalRuns})`);
    }
    lines.push("");
  }

  if (reviewed.rejected.length > 0) {
    lines.push("## Rejected observations", "");
    for (const item of reviewed.rejected) {
      lines.push(`- run ${item.runIndex + 1}: ${item.signature ?? "unknown"} — ${item.reasons.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
