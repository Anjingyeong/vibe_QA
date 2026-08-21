import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createQuickScanService } from "../web/scan-service.js";

function safeName(value) {
  return new URL(value).hostname.replace(/[^a-z0-9.-]+/giu, "_");
}

export async function runGenericShadow(targets, {
  runCount = 2,
  maxPages = 3,
  outputRoot = path.join("artifacts", "generic-shadow"),
} = {}) {
  const runScan = createQuickScanService({ runCount, maxPages, artifactsRoot: outputRoot });
  const results = [];
  for (const target of targets) {
    try {
      const result = await runScan(target, { scanId: safeName(target) });
      results.push({
        target,
        status: "completed",
        summary: result.report.summary,
        coverage: result.report.coverage,
        discoveryCandidates: result.discovery.length,
      });
    } catch (error) {
      results.push({ target, status: "failed", error: error?.message ?? "Unknown shadow scan failure" });
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    runCount,
    maxPages,
    results,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, "summary.json"), JSON.stringify(output, null, 2), "utf8");
  return output;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const targets = process.argv.slice(2);
  if (!targets.length) throw new Error("Usage: node src/shadow/run-generic.js <https-url> [https-url...]");
  const result = await runGenericShadow(targets, {
    runCount: Number(process.env.VIBECHECK_SHADOW_RUNS ?? 2),
    maxPages: Number(process.env.VIBECHECK_SHADOW_MAX_PAGES ?? 3),
  });
  console.log(JSON.stringify(result, null, 2));
}
