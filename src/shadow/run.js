import path from "node:path";
import { scanBrowser } from "../scanner/browser-scanner.js";
import { reviewRuns } from "../reviewer/evidence-reviewer.js";
import { classifyPreflight } from "./preflight.js";

async function inspectTarget(url, runCount = 3) {
  const response = await fetch(url, { redirect: "manual" });
  const preflight = classifyPreflight({
    status: response.status,
    location: response.headers.get("location") ?? "",
  });

  if (!preflight.runnable) {
    return { url, status: response.status, preflight, reviewed: null };
  }

  const host = new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, "_");
  const runs = [];
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await scanBrowser(url, {
      screenshotDir: path.join("artifacts", "shadow", host, `run-${index + 1}`),
    }));
  }

  return {
    url,
    status: response.status,
    preflight,
    reviewed: reviewRuns(runs),
  };
}

export async function runShadow(targets, { runCount = 3 } = {}) {
  const results = [];
  for (const target of targets) {
    try {
      results.push(await inspectTarget(target, runCount));
    } catch (error) {
      results.push({
        url: target,
        preflight: { kind: "error", runnable: false },
        error: error.message,
        reviewed: null,
      });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const targets = process.argv.slice(2);
  const results = await runShadow(targets.length ? targets : [
    "https://songsong.jingyeong.cloud",
    "https://jk.jingyeong.cloud",
    "https://jingyeong.cloud",
  ]);
  console.log(JSON.stringify(results, null, 2));
}