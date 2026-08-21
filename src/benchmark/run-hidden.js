import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startHiddenFixtureServer } from "../fixture/hidden-server.js";
import { scan } from "../scanner/deterministic-scanner.js";
import { reviewRuns } from "../reviewer/evidence-reviewer.js";
import { scoreBenchmark } from "./scorer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

async function loadTruth() {
  return JSON.parse(await readFile(path.join(HERE, "hidden-ground-truth.json"), "utf8"));
}

export async function runHiddenBenchmark({ runCount = 3, writeArtifacts = true } = {}) {
  // The fixture IDs are public to the runner, but expected issue signatures are not loaded
  // until all scanning has completed.
  const caseIds = ["broken-v2", "clean-v2"];
  const rawCases = [];

  for (const caseId of caseIds) {
    const fixture = await startHiddenFixtureServer(caseId, 0);
    try {
      const runs = [];
      for (let index = 0; index < runCount; index += 1) {
        runs.push(await scan(fixture.baseUrl));
      }
      rawCases.push({ caseId, runs, reviewed: reviewRuns(runs) });
    } finally {
      await fixture.close();
    }
  }

  // Blind boundary: expected findings enter memory only after every scan has finished.
  const truth = await loadTruth();
  const scoredCases = rawCases.map((entry) => {
    const expected = truth.cases.find((item) => item.fixture === entry.caseId);
    if (!expected) throw new Error(`Missing ground truth for ${entry.caseId}`);
    return { ...entry, score: scoreBenchmark(expected, entry.reviewed) };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    suite: truth.suite,
    runCount,
    passed: scoredCases.every((entry) => entry.score.passed),
    cases: scoredCases,
  };

  if (writeArtifacts) {
    const artifactDir = path.join(ROOT, "artifacts");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      path.join(artifactDir, "hidden-last-run.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8"
    );
  }

  return result;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runHiddenBenchmark();
  console.log(`# Hidden benchmark: ${result.passed ? "PASS" : "FAIL"}`);
  for (const entry of result.cases) {
    const m = entry.score.metrics;
    console.log(
      `${entry.caseId}: ${entry.score.passed ? "PASS" : "FAIL"} | recall=${pct(m.criticalMajorRecall)} fp=${pct(m.falsePositiveRate)} repro=${pct(m.reproducibility)} confirmed=${m.confirmedCount}`
    );
    if (entry.score.falsePositives.length) console.log(`  FP: ${entry.score.falsePositives.join(", ")}`);
    if (entry.score.falseNegatives.length) console.log(`  FN: ${entry.score.falseNegatives.join(", ")}`);
  }
  process.exitCode = result.passed ? 0 : 1;
}