import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { DEFAULT_TARGET, authorizeTarget } from "./flow/target-policy.js";
import { createSanitizer } from "./flow/sanitize.js";
import { REQUIRED_FLOW_IDS, buildPlan, summarize, review, PROFILES } from "./flow/plan.js";
import { runProfile } from "./flow/profile.js";
import { validateRunFindings } from "./flow/evidence.js";

export { REQUIRED_FLOW_IDS };

function normalizeForPlan(value = DEFAULT_TARGET) {
  const url = new URL(value);
  url.hash = ""; url.search = "";
  return url.href.replace(/\/$/u, "");
}

export function buildFlowRunPlan({ target = DEFAULT_TARGET, browser = "msedge", runs = 3 } = {}) {
  return buildPlan({ target: normalizeForPlan(target), browser, runs });
}

export function summarizeFlowRuns(runs) {
  return summarize(runs, 3);
}

export function reviewFlowRuns(runs, options) {
  return review(runs, options);
}

async function writeSafe(file, value, sanitizer) {
  const serialized = `${sanitizer.serialize(value)}\n`;
  sanitizer.assertSafe(serialized);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serialized, "utf8");
}

function resolveOutputDirectory(output, allowPrivateForTesting) {
  const resolved = path.resolve(output);
  if (allowPrivateForTesting) return resolved;
  const relative = path.relative(process.cwd(), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("output must be beneath the project evidence or artifacts directory");
  }
  const [root] = relative.split(path.sep);
  if (root !== "evidence" && root !== "artifacts") {
    throw new Error("output must be beneath the project evidence or artifacts directory");
  }
  return resolved;
}

export async function runFlowBrowserBenchmark({
  target = DEFAULT_TARGET, browser = "msedge", runs = 3,
  output = path.resolve("artifacts", "flow-browser"), allowHosts,
  allowPrivateForTesting = false, lookup,
} = {}) {
  const policy = await authorizeTarget(target, { allowHosts, allowPrivateForTesting, lookup });
  const plan = buildPlan({ target: policy.origin, browser, runs });
  const outputDir = resolveOutputDirectory(output, allowPrivateForTesting);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const sanitizer = createSanitizer();
  const results = [];
  let evidenceIdentities = new Map();
  for (let number = 1; number <= plan.runs; number += 1) {
    const runId = `run-${String(number).padStart(2, "0")}`;
    const run = { runId, profiles: {} };
    let instance;
    try {
      const launch = plan.browser === "chromium" ? { headless: true } : { channel: plan.browser, headless: true };
      instance = await chromium.launch(launch);
      for (const profile of Object.keys(PROFILES)) {
        const execution = plan.executions.find((item) => item.runId === runId && item.profile === profile);
        run.profiles[profile] = await runProfile({ browser: instance, execution, target: policy.origin,
          artifactRoot: outputDir, policy, sanitizer, lookup });
        evidenceIdentities = await validateRunFindings(run.profiles[profile].findings,
          { artifactRoot: outputDir, identities: evidenceIdentities });
        await writeSafe(path.join(outputDir, runId, profile, "result.json"), run.profiles[profile], sanitizer);
      }
    } finally {
      if (instance && instance.contexts().length) {
        await instance.close();
        throw new Error(`${instance.contexts().length} BrowserContext leak(s) before browser close`);
      }
      await instance?.close();
    }
    results.push(run);
    await writeSafe(path.join(outputDir, runId, "result.json"), run, sanitizer);
  }
  const aggregate = { generatedAt: new Date().toISOString(), target: policy.origin, browser: plan.browser,
    requestedRuns: plan.runs, ...summarize(results, plan.runs), reviewed: review(results),
    fixtureReference: "evidence/songsong-flow/aggregate.json", runs: results };
  await writeSafe(path.join(outputDir, "aggregate.json"), aggregate, sanitizer);
  return sanitizer.clean(aggregate);
}

function usage() {
  return `Usage: node src/benchmark/run-flow-browser.js [options]\n\nOptions:\n  --target <url>      Target web application (default: ${DEFAULT_TARGET})\n  --browser <channel> Playwright Chromium channel (default: msedge)\n  --runs <count>      Independent browser sessions (default: 3)\n  --output <dir>      Artifact directory (default: artifacts/flow-browser)\n  --help              Show this usage text`;
}

function parseArgs(args) {
  const options = {}; const allowed = new Set(["target", "browser", "runs", "output"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--") || !allowed.has(argument.slice(2))) throw new Error(`Unknown option: ${argument}`);
    const value = args[++index]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = argument === "--runs" ? Number(value) : value;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const result = await runFlowBrowserBenchmark(options);
      console.log(`# Flow browser benchmark: ${result.passed ? "PASS" : "FAIL"}`);
      console.log(`runs=${result.runCount} missing=${result.missing.length} incompleteEvidence=${result.incompleteFindings.length}`);
      console.log(`aggregate=${path.resolve(options.output ?? path.join("artifacts", "flow-browser"), "aggregate.json")}`);
      process.exitCode = result.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error).replace(/(bearer\s+)\S+/giu, "$1[REDACTED]"));
    console.error(usage()); process.exitCode = 1;
  }
}
