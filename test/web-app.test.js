import test from "node:test";
import assert from "node:assert/strict";
import { createVibeCheckServer, validateCustomerTarget } from "../src/web/app.js";

test("customer target validation accepts only simple HTTPS targets", () => {
  assert.equal(validateCustomerTarget("https://example.com"), "https://example.com/");
  assert.throws(() => validateCustomerTarget("http://example.com"), /Only HTTPS/);
  assert.throws(() => validateCustomerTarget("https://user:pass@example.com"), /credentials/);
  assert.throws(() => validateCustomerTarget("https://example.com:8443"), /Custom ports/);
});

test("web app queues a scan, exposes progress, and serves completed result", async (t) => {
  const app = createVibeCheckServer({
    async runScan(url, { onProgress }) {
      assert.equal(url, "https://example.com/");
      onProgress({ stage: "explore", progress: 30, message: "Exploring" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      onProgress({ stage: "browser", progress: 70, message: "Browser QA" });
      return {
        report: { summary: { confirmed: 1, provisional: 0, bySeverity: { critical: 0, major: 1, minor: 0 } } },
        reportHtml: "<!doctype html><html><body><h1>Evidence result</h1></body></html>",
      };
    },
  });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /검사 시작/);

  const created = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.match(job.id, /^[0-9a-f-]+$/);

  let state;
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(`${base}/api/scans/${job.id}`);
    state = await response.json();
    if (state.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(state.status, "completed");
  assert.equal(state.progress, 100);
  assert.equal(state.summary.major, undefined);
  assert.equal(state.summary.bySeverity.major, 1);

  const result = await fetch(`${base}/results/${job.id}`);
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Evidence result/);
});

test("web app rejects unsafe target input before scheduling", async (t) => {
  let calls = 0;
  const app = createVibeCheckServer({ async runScan() { calls += 1; } });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1" }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("completed scans expose unguessable share and HTML/JSON export routes", async (t) => {
  const app = createVibeCheckServer({
    async runScan() {
      return {
        report: { target: "https://example.com/", summary: { confirmed: 0, provisional: 0, bySeverity: { critical: 0, major: 0, minor: 0 } } },
        reportHtml: "<!doctype html><html><body><h1>Shareable report</h1></body></html>",
      };
    },
  });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  const initial = await created.json();
  let state;
  for (let index = 0; index < 20; index += 1) {
    state = await (await fetch(`${base}/api/scans/${initial.id}`)).json();
    if (state.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(state.shareUrl, /^\/share\/[0-9a-f-]+$/);
  assert.match(state.reportJsonUrl, /report\.json$/);
  assert.match(state.reportHtmlUrl, /report\.html$/);

  const shared = await fetch(`${base}${state.shareUrl}`);
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /Shareable report/);

  const jsonReport = await fetch(`${base}${state.reportJsonUrl}`);
  assert.equal(jsonReport.status, 200);
  assert.match(jsonReport.headers.get("content-disposition"), /attachment/);
  assert.equal((await jsonReport.json()).target, "https://example.com/");

  const htmlReport = await fetch(`${base}${state.reportHtmlUrl}`);
  assert.equal(htmlReport.status, 200);
  assert.match(htmlReport.headers.get("content-disposition"), /attachment/);
  assert.match(await htmlReport.text(), /Shareable report/);
});

test("web app applies scan rate limiting before queueing excess work", async (t) => {
  let consumed = 0;
  let calls = 0;
  const app = createVibeCheckServer({
    async runScan() { calls += 1; return { report: { summary: {} }, reportHtml: "ok" }; },
    rateLimiter: {
      consume() {
        consumed += 1;
        return consumed === 1 ? { allowed: true, remaining: 0, retryAfterMs: 0 } : { allowed: false, remaining: 0, retryAfterMs: 30_000 };
      },
    },
    clientKey: () => "client",
  });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const request = () => fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.equal((await request()).status, 202);
  const blocked = await request();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).retryAfterSeconds, 30);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
});
