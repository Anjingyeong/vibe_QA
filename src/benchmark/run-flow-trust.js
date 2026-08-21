import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scoreFlowBenchmark } from "./flow-scorer.js";
import { executeBrowserCleanControl, validateCleanControl } from "./flow-trust/clean-control.js";
import { deriveNegativeOpportunityCount, deriveRawReview } from "./flow-trust/raw-review.js";
import { deepFreeze, scanModuleImports, sha256 } from "./flow-trust/isolation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const USAGE =
  "Usage: node src/benchmark/run-flow-trust.js --input <scanner-aggregate.json|directory> --ground-truth <ground-truth.json> --output <report.json>";
const REQUIRED_OPTIONS = new Set(["--input", "--ground-truth", "--output"]);

export function parseFlowTrustArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!REQUIRED_OPTIONS.has(option) || !value || value.startsWith("--") || options[option]) {
      throw new Error(USAGE);
    }
    options[option] = value;
  }
  if (args.length !== REQUIRED_OPTIONS.size * 2 ||
      [...REQUIRED_OPTIONS].some((option) => !options[option])) throw new Error(USAGE);
  return { input: options["--input"], groundTruth: options["--ground-truth"],
    output: options["--output"] };
}

async function resolveAggregateInput(input) {
  const resolved = path.resolve(input);
  return (await stat(resolved)).isDirectory() ? path.join(resolved, "aggregate.json") : resolved;
}

export async function runFlowTrust({ input, groundTruth, output }, dependencies = {}) {
  const executeCleanControl = dependencies.executeCleanControl ?? executeBrowserCleanControl;
  const callOrder = [];
  const outputFile = path.resolve(output);
  await mkdir(path.dirname(outputFile), { recursive: true });

  const aggregateFile = await resolveAggregateInput(input);
  const aggregateBytes = await readFile(aggregateFile);
  const scannerAggregateHash = sha256(aggregateBytes);
  const scannerAggregate = deepFreeze(JSON.parse(aggregateBytes.toString("utf8")));
  const sealedHashBeforeTruth = sha256(JSON.stringify(scannerAggregate));
  callOrder.push("load-and-seal-scanner-aggregate");

  const reviewed = await deriveRawReview(scannerAggregate, path.dirname(aggregateFile));
  const cleanEvidencePath = path.join(path.dirname(outputFile), "flow-trust-clean-control");
  callOrder.push("execute-clean-control");
  const cleanResult = validateCleanControl(
    await executeCleanControl({ evidencePath: cleanEvidencePath }), cleanEvidencePath);

  const truthBytes = await readFile(path.resolve(groundTruth));
  const expectedTruth = deepFreeze(JSON.parse(truthBytes.toString("utf8")));
  callOrder.push("load-ground-truth");
  const negativeOpportunities = deriveNegativeOpportunityCount(expectedTruth);
  const score = scoreFlowBenchmark(expectedTruth, reviewed, {
    negativeOpportunities: negativeOpportunities.count,
    cleanControlConfirmed: cleanResult.reviewed.confirmed,
  });
  callOrder.push("score-flow-benchmark");

  const scannerModuleImports = await scanModuleImports(path.join(HERE, "run-flow-browser.js"), ROOT);
  callOrder.push("scan-scanner-imports");
  const scannerImportsGroundTruth = scannerModuleImports.some(({ importer, specifier }) =>
    /ground-truth/iu.test(importer) || /ground-truth/iu.test(specifier));
  const sealedHashAfterTruth = sha256(JSON.stringify(scannerAggregate));
  const aggregateLoadIndex = callOrder.indexOf("load-and-seal-scanner-aggregate");
  const cleanControlIndex = callOrder.indexOf("execute-clean-control");
  const truthLoadIndex = callOrder.indexOf("load-ground-truth");
  const metrics = score.metrics;
  const report = {
    passed: score.passed,
    gates: score.gates,
    metrics,
    denominator: negativeOpportunities,
    reviewed,
    confusion: { truePositives: metrics.truePositiveCount, falsePositives: metrics.falsePositiveCount,
      falseNegatives: metrics.falseNegativeCount, severityMismatches: metrics.severityMismatchCount,
      falseDiscoveries: metrics.falseDiscoveryCount },
    rates: { criticalMajorRecall: metrics.criticalMajorRecall,
      falsePositiveRate: metrics.falsePositiveRate, falseDiscoveryRate: metrics.falseDiscoveryRate },
    reproducibility: { minimum: metrics.reproducibility,
      average: metrics.averageReproducibility, runCount: reviewed.runCount },
    fixtureReferences: { scannerAggregate: aggregateFile, groundTruth: path.resolve(groundTruth),
      cleanControl: cleanResult.fixture },
    cleanControl: { fixture: cleanResult.fixture, runCount: cleanResult.runCount,
      evidencePath: cleanEvidencePath, confirmedCount: cleanResult.reviewed.confirmed.length,
      rejectedCount: cleanResult.reviewed.rejected.length },
    hashes: { scannerAggregate: scannerAggregateHash, groundTruth: sha256(truthBytes),
      sealedScannerAggregateBeforeTruth: sealedHashBeforeTruth,
      sealedScannerAggregateAfterTruth: sealedHashAfterTruth },
    isolationProof: {
      callOrder,
      scannerAggregateLoadedBeforeGroundTruth: aggregateLoadIndex >= 0 && aggregateLoadIndex < truthLoadIndex,
      cleanControlExecutedBeforeGroundTruth: cleanControlIndex >= 0 && cleanControlIndex < truthLoadIndex,
      scannerAggregateHashStable: sealedHashBeforeTruth === sealedHashAfterTruth,
      scannerAggregateSealed: Object.isFrozen(scannerAggregate),
      scannerModuleImports,
      scannerImportsGroundTruth,
      groundTruthPassedToScanner: scannerImportsGroundTruth || cleanControlIndex > truthLoadIndex,
    },
    score,
  };
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseFlowTrustArgs(process.argv.slice(2));
    if (options.help) console.log(USAGE);
    else {
      const report = await runFlowTrust(options);
      console.log(`Flow trust gate: ${report.passed ? "PASS" : "FAIL"}`);
      process.exitCode = report.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
