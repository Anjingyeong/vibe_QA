import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startBrowserFixtureServer } from "../fixture/browser-server.js";
import { scanBrowser } from "../scanner/browser-scanner.js";
import { reviewRuns } from "../reviewer/evidence-reviewer.js";
import { scoreBenchmark } from "./scorer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

async function loadTruth() {
  return JSON.parse(await readFile(path.join(HERE, "browser-ground-truth.json"), "utf8"));
}

export async function runBrowserBenchmark({ runCount = 3, writeArtifacts = true } = {}) {
  const caseIds = ["broken-browser-v1", "clean-browser-v1"];
  const rawCases = [];
  const rootScreenshotDir = path.join(ROOT, "artifacts", "browser");

  for (const caseId of caseIds) {
    const fixture = await startBrowserFixtureServer(caseId, 0);
    try {
      const runs = [];
      for (let index = 0; index < runCount; index += 1) {
        runs.push(await scanBrowser(fixture.baseUrl, {
          screenshotDir: path.join(rootScreenshotDir, caseId, `run-${index + 1}`),
        }));
      }
      rawCases.push({ caseId, runs, reviewed: reviewRuns(runs) });
    } finally {
      await fixture.close();
    }
  }

  const truth = await loadTruth();
  const cases = rawCases.map((entry) => {
    const expected = truth.cases.find((item) => item.fixture === entry.caseId);
    if (!expected) throw new Error(`Missing browser ground truth for ${entry.caseId}`);
    return { ...entry, score: scoreBenchmark(expected, entry.reviewed) };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    suite: truth.suite,
    runCount,
    passed: cases.every((entry) => entry.score.passed),
    cases,
  };

  if (writeArtifacts) {
    await mkdir(path.join(ROOT, "artifacts"), { recursive: true });
    await writeFile(
      path.join(ROOT, "artifacts", "browser-last-run.json"),
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
  const result = await runBrowserBenchmark();
  console.log(`# Browser benchmark: ${result.passed ? "PASS" : "FAIL"}`);
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