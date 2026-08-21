import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createFileJobStore } from "../src/web/job-store.js";
import { createSlidingWindowRateLimiter, requestClientKey } from "../src/web/rate-limit.js";

test("file job store persists completed jobs and marks interrupted jobs failed after restart", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecheck-jobs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "jobs.json");
  const store = await createFileJobStore({ filePath, ttlMs: 60_000 });
  const now = new Date().toISOString();
  await store.set({ id: "done", status: "completed", createdAt: now, updatedAt: now, result: { ok: true } });
  await store.set({ id: "running", status: "running", stage: "browser", createdAt: now, updatedAt: now });
  await store.flush();

  const restored = await createFileJobStore({ filePath, ttlMs: 60_000 });
  assert.equal(restored.get("done").status, "completed");
  assert.equal(restored.get("done").result.ok, true);
  assert.equal(restored.get("running").status, "failed");
  assert.match(restored.get("running").error, /server restart/i);
});

test("file job store removes expired jobs", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecheck-ttl-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 1_000_000;
  const store = await createFileJobStore({ filePath: path.join(dir, "jobs.json"), ttlMs: 60_000, now: () => clock });
  const stamp = new Date(clock).toISOString();
  await store.set({ id: "old", status: "completed", createdAt: stamp, updatedAt: stamp });
  clock += 60_001;
  assert.equal(await store.cleanup(), 1);
  assert.equal(store.get("old"), undefined);
});

test("sliding window limiter blocks excess scans and resets after the window", () => {
  let clock = 10_000;
  const limiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1_000, now: () => clock });
  assert.equal(limiter.consume("client").allowed, true);
  assert.equal(limiter.consume("client").allowed, true);
  const blocked = limiter.consume("client");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  clock += 1_001;
  assert.equal(limiter.consume("client").allowed, true);
});

test("client key trusts Cloudflare connecting IP but not arbitrary forwarded-for", () => {
  assert.equal(requestClientKey({
    headers: {
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "198.51.100.4",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }), "203.0.113.5");

  assert.equal(requestClientKey({
    headers: { "x-forwarded-for": "198.51.100.4" },
    socket: { remoteAddress: "127.0.0.1" },
  }), "127.0.0.1");
});
