import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runBenchmark } from "./run.js";
import { runHiddenBenchmark } from "./run-hidden.js";
import { runBrowserBenchmark } from "./run-browser.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function rejectedCount(result) {
  if (result.reviewed) return result.reviewed.rejected.length;
  return (result.cases ?? []).reduce(
    (sum, entry) => sum + (entry.reviewed?.rejected?.length ?? 0),
    0
  );
}

export async function runTrustSuite({ writeArtifacts = true } = {}) {
  const seeded = await runBenchmark({ runCount: 3, writeArtifacts: false });
  const hidden = await runHiddenBenchmark({ runCount: 3, writeArtifacts: false });
  const browser = await runBrowserBenchmark({ runCount: 3, writeArtifacts: false });

  const lanes = [
    { name: "seeded", passed: seeded.score.passed, rejected: rejectedCount(seeded) },
    { name: "hidden", passed: hidden.passed, rejected: rejectedCount(hidden) },
    { name: "browser", passed: browser.passed, rejected: rejectedCount(browser) },
  ];
  const result = {
    generatedAt: new Date().toISOString(),
    passed: lanes.every((lane) => lane.passed && lane.rejected === 0),
    lanes,
    seeded,
    hidden,
    browser,
  };

  if (writeArtifacts) {
    const artifactDir = path.join(ROOT, "artifacts");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      path.join(artifactDir, "trust-last-run.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8"
    );
  }

  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runTrustSuite();
  console.log(`# VibeCheck trust gate: ${result.passed ? "PASS" : "FAIL"}`);
  for (const lane of result.lanes) {
    console.log(`${lane.name}: ${lane.passed ? "PASS" : "FAIL"} | reviewer-rejected=${lane.rejected}`);
  }
  process.exitCode = result.passed ? 0 : 1;
}