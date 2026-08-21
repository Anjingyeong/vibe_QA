import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startFixtureServer } from "../fixture/server.js";
import { scan } from "../scanner/deterministic-scanner.js";
import { reviewRuns } from "../reviewer/evidence-reviewer.js";
import { scoreBenchmark } from "./scorer.js";
import { renderMarkdownReport } from "./report.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

async function loadGroundTruth() {
  const raw = await readFile(path.join(HERE, "ground-truth.json"), "utf8");
  return JSON.parse(raw);
}

export async function runBenchmark({
  runCount = 3,
  writeArtifacts = true,
} = {}) {
  const fixture = await startFixtureServer(0);
  try {
    const runs = [];
    for (let index = 0; index < runCount; index += 1) {
      runs.push(await scan(fixture.baseUrl));
    }

    // Ground truth is loaded only after scanning is complete.
    const groundTruth = await loadGroundTruth();
    const reviewed = reviewRuns(runs);
    const score = scoreBenchmark(groundTruth, reviewed);
    const result = {
      generatedAt: new Date().toISOString(),
      fixture: groundTruth.fixture,
      runCount,
      score,
      reviewed,
      runs,
    };

    if (writeArtifacts) {
      const artifactDir = path.join(ROOT, "artifacts");
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        path.join(artifactDir, "last-run.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        path.join(artifactDir, "last-report.md"),
        `${renderMarkdownReport(result)}\n`,
        "utf8"
      );
    }

    return result;
  } finally {
    await fixture.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBenchmark();
  console.log(renderMarkdownReport(result));
  process.exitCode = result.score.passed ? 0 : 1;
}
