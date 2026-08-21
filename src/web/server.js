import { createVibeCheckServer } from "./app.js";
import { createQuickScanService } from "./scan-service.js";
import { createFileJobStore } from "./job-store.js";
import { createSlidingWindowRateLimiter } from "./rate-limit.js";
import { createDiscoveryStackFromEnv } from "../discovery/ensemble-discovery.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

const jobStore = await createFileJobStore({
  filePath: process.env.VIBECHECK_JOB_STORE ?? "artifacts/web/jobs.json",
  ttlMs: Number(process.env.VIBECHECK_JOB_TTL_MS ?? 24 * 60 * 60 * 1000),
});
const rateLimiter = createSlidingWindowRateLimiter({
  limit: Number(process.env.VIBECHECK_RATE_LIMIT ?? 5),
  windowMs: Number(process.env.VIBECHECK_RATE_WINDOW_MS ?? 60 * 60 * 1000),
});
const discoveryAdapter = createDiscoveryStackFromEnv(process.env);

const runScan = createQuickScanService({
  runCount: Number(process.env.VIBECHECK_RUNS ?? 3),
  maxPages: Number(process.env.VIBECHECK_MAX_PAGES ?? 4),
  discoveryAdapter,
});
const app = createVibeCheckServer({
  runScan,
  maxConcurrent: Number(process.env.VIBECHECK_CONCURRENCY ?? 1),
  maxJobs: Number(process.env.VIBECHECK_MAX_JOBS ?? 50),
  jobStore,
  rateLimiter,
});

const address = await app.listen(port, host);
console.log(`VibeCheck web listening on http://${address.address}:${address.port}`);

async function shutdown(signal) {
  console.log(`VibeCheck web received ${signal}; closing.`);
  try { await app.close(); }
  finally { process.exit(0); }
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
