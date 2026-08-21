import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return structuredClone(value);
}

function isExpired(job, nowMs, ttlMs) {
  const updated = Date.parse(job?.updatedAt ?? job?.createdAt ?? "");
  return Number.isFinite(updated) && nowMs - updated > ttlMs;
}

export function createMemoryJobStore(initial = []) {
  const jobs = new Map(initial.map((job) => [job.id, clone(job)]));
  return {
    get size() { return jobs.size; },
    get(id) { return jobs.get(id); },
    values() { return jobs.values(); },
    async set(job) { jobs.set(job.id, job); },
    async touch() {},
    async delete(id) { jobs.delete(id); },
    async cleanup() { return 0; },
  };
}

export async function createFileJobStore({
  filePath = path.join("artifacts", "web", "jobs.json"),
  ttlMs = 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 60_000) throw new Error("ttlMs must be at least 60000");
  const jobs = new Map();
  let writeChain = Promise.resolve();

  async function persist() {
    const payload = JSON.stringify({ version: 1, jobs: [...jobs.values()] }, null, 2);
    const dir = path.dirname(filePath);
    const tmp = `${filePath}.tmp`;
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, filePath);
  }

  function schedulePersist() {
    writeChain = writeChain.then(persist, persist);
    return writeChain;
  }

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (Array.isArray(parsed?.jobs)) {
      for (const raw of parsed.jobs) {
        if (!raw?.id || isExpired(raw, now(), ttlMs)) continue;
        const job = clone(raw);
        if (job.status === "running" || job.status === "queued") {
          job.status = "failed";
          job.stage = "failed";
          job.error = "Scan was interrupted by a server restart.";
          job.message = "서버 재시작으로 검사가 중단됐습니다.";
          job.updatedAt = new Date(now()).toISOString();
        }
        jobs.set(job.id, job);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await schedulePersist();

  return {
    get size() { return jobs.size; },
    get(id) { return jobs.get(id); },
    values() { return jobs.values(); },
    async set(job) { jobs.set(job.id, job); await schedulePersist(); },
    async touch() { await schedulePersist(); },
    async delete(id) { jobs.delete(id); await schedulePersist(); },
    async cleanup() {
      let removed = 0;
      const stamp = now();
      for (const [id, job] of jobs) {
        if (!isExpired(job, stamp, ttlMs)) continue;
        jobs.delete(id);
        removed += 1;
      }
      if (removed) await schedulePersist();
      return removed;
    },
    async flush() { await writeChain; },
  };
}
