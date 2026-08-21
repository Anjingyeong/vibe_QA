import http from "node:http";
import { randomUUID } from "node:crypto";
import { createMemoryJobStore } from "./job-store.js";
import { requestClientKey } from "./rate-limit.js";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

function attachment(res, status, body, contentType, filename) {
  const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(payload),
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

async function readJsonBody(req, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid JSON body"); }
}

export function validateCustomerTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid HTTPS URL"); }
  if (url.protocol !== "https:") throw new Error("Only HTTPS public websites can be scanned");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (url.port) throw new Error("Custom ports are not supported");
  url.hash = "";
  return url.href;
}

function publicJob(job) {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    resultUrl: job.status === "completed" ? `/results/${job.id}` : null,
    shareUrl: job.status === "completed" ? `/share/${job.shareToken}` : null,
    reportJsonUrl: job.status === "completed" ? `/api/scans/${job.id}/report.json` : null,
    reportHtmlUrl: job.status === "completed" ? `/results/${job.id}/report.html` : null,
    error: job.status === "failed" ? job.error : null,
    summary: job.status === "completed" ? job.result?.report?.summary ?? null : null,
  };
}

function shell(title, body, script = "") {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#f5f7fa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}main{max-width:980px;margin:0 auto;padding:72px 24px}.brand{font-weight:900;letter-spacing:-.04em;font-size:22px}.hero{padding:72px 0 36px}.hero h1{font-size:clamp(40px,7vw,76px);line-height:.98;letter-spacing:-.06em;margin:0 0 22px}.muted{color:#9aa6b5}.panel{background:#141820;border:1px solid #29303d;border-radius:22px;padding:22px;box-shadow:0 24px 80px #0005}.scan-form{display:flex;gap:10px}.scan-form input{flex:1;min-width:0;background:#0c1016;border:1px solid #343d4d;color:#fff;border-radius:14px;padding:17px 18px;font-size:16px;outline:none}.scan-form input:focus{border-color:#7d91ff}.btn{border:0;border-radius:14px;padding:0 22px;font-weight:800;background:#f5f7fa;color:#0b0d10;cursor:pointer}.btn:disabled{opacity:.5;cursor:wait}.steps{display:grid;gap:12px;margin-top:20px}.step{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#0d1118;border-radius:12px}.bar{height:8px;background:#232a36;border-radius:999px;overflow:hidden;margin-top:18px}.bar>div{height:100%;background:#eef1ff;width:0%;transition:width .25s}.error{color:#ff9d9d}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.metric{background:#0d1118;border-radius:14px;padding:18px}.metric b{display:block;font-size:30px}.link{color:#b9c4ff;text-decoration:none}@media(max-width:640px){main{padding:34px 16px}.hero{padding:44px 0 24px}.scan-form{flex-direction:column}.btn{padding:16px}.hero h1{font-size:46px}}
  </style></head><body><main><div class="brand">VibeCheck</div>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function landingPage() {
  return shell("VibeCheck — Evidence-first launch QA", `
    <section class="hero"><p class="muted">EVIDENCE-FIRST LAUNCH QA</p><h1>배포 전에,<br>망가진 곳부터 찾습니다.</h1><p class="muted">공개 웹사이트 URL을 입력하면 실제 브라우저로 데스크톱·모바일·네트워크·콘솔을 반복 검증합니다.</p></section>
    <section class="panel"><form id="scan" class="scan-form"><input id="url" name="url" type="url" required inputmode="url" autocomplete="url" placeholder="https://example.com"><button id="submit" class="btn" type="submit">검사 시작</button></form><p id="error" class="error"></p></section>`, `
    const form=document.getElementById('scan'),input=document.getElementById('url'),button=document.getElementById('submit'),error=document.getElementById('error');
    form.addEventListener('submit',async(e)=>{e.preventDefault();error.textContent='';button.disabled=true;button.textContent='준비 중…';try{const r=await fetch('/api/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:input.value})});const data=await r.json();if(!r.ok)throw new Error(data.error||'검사를 시작하지 못했습니다.');location.href='/results/'+data.id;}catch(err){error.textContent=err.message;button.disabled=false;button.textContent='검사 시작';}});`);
}

function pendingPage(job) {
  return shell(`VibeCheck — ${job.status}`, `
    <section class="hero"><p class="muted">${esc(job.url)}</p><h1 id="headline">사이트를 검사하고 있습니다.</h1><p id="message" class="muted">${esc(job.message)}</p></section>
    <section class="panel"><div class="bar"><div id="progress" style="width:${job.progress}%"></div></div><div class="steps"><div class="step"><span>현재 단계</span><strong id="stage">${esc(job.stage)}</strong></div><div class="step"><span>진행률</span><strong id="percent">${job.progress}%</strong></div></div><p id="error" class="error"></p></section>`, `
    const id=${JSON.stringify(job.id)};async function poll(){try{const r=await fetch('/api/scans/'+id,{cache:'no-store'});const j=await r.json();document.getElementById('stage').textContent=j.stage;document.getElementById('percent').textContent=j.progress+'%';document.getElementById('progress').style.width=j.progress+'%';document.getElementById('message').textContent=j.message||'';if(j.status==='completed'){location.reload();return;}if(j.status==='failed'){document.getElementById('headline').textContent='검사를 완료하지 못했습니다.';document.getElementById('error').textContent=j.error||'Unknown error';return;}setTimeout(poll,1000);}catch{setTimeout(poll,1800)}}poll();`);
}

function completedPage(job) {
  if (typeof job.result?.reportHtml === "string") {
    const toolbar = `<section style="max-width:980px;margin:18px auto;padding:0 32px"><div style="display:flex;gap:10px;flex-wrap:wrap"><a href="/share/${esc(job.shareToken)}">공유 링크</a><a href="/results/${esc(job.id)}/report.html">HTML 저장</a><a href="/api/scans/${esc(job.id)}/report.json">JSON 저장</a></div></section>`;
    return job.result.reportHtml.includes("</body>") ? job.result.reportHtml.replace("</body>", `${toolbar}</body>`) : `${job.result.reportHtml}${toolbar}`;
  }
  const summary = job.result?.report?.summary ?? { confirmed: 0, provisional: 0, bySeverity: {} };
  return shell("VibeCheck — Result", `<section class="hero"><p class="muted">${esc(job.url)}</p><h1>검사가 완료됐습니다.</h1></section><section class="panel"><div class="summary"><div class="metric"><b>${summary.confirmed ?? 0}</b>Confirmed</div><div class="metric"><b>${summary.bySeverity?.critical ?? 0}</b>Critical</div><div class="metric"><b>${summary.bySeverity?.major ?? 0}</b>Major</div><div class="metric"><b>${summary.bySeverity?.minor ?? 0}</b>Minor</div></div></section>`);
}

export function createVibeCheckServer({
  runScan,
  maxJobs = 50,
  maxConcurrent = 1,
  jobStore = createMemoryJobStore(),
  rateLimiter = null,
  clientKey = requestClientKey,
} = {}) {
  if (typeof runScan !== "function") throw new Error("runScan is required");
  if (!Number.isInteger(maxJobs) || maxJobs < 1) throw new Error("maxJobs must be positive");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) throw new Error("maxConcurrent must be 1..4");

  const jobs = jobStore;
  const queue = [];
  let active = 0;

  function update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  }

  function processQueue() {
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift();
      active += 1;
      update(job, { status: "running", stage: "preflight", progress: 5, message: "공개 사이트와 검사 범위를 확인하고 있습니다." });
      void Promise.resolve(jobs.touch?.()).catch(() => {});
      Promise.resolve().then(() => runScan(job.url, {
        scanId: job.id,
        onProgress(event) {
          const progress = Math.max(job.progress, Math.min(99, Number(event?.progress) || job.progress));
          update(job, { stage: event?.stage ?? job.stage, progress, message: event?.message ?? job.message });
        },
      })).then(async (result) => {
        update(job, { status: "completed", stage: "completed", progress: 100, message: "검사가 완료됐습니다.", result });
        await jobs.touch?.();
      }).catch(async (error) => {
        update(job, { status: "failed", stage: "failed", progress: Math.max(job.progress, 5), message: "검사가 중단됐습니다.", error: error?.message ?? "Unknown scan failure" });
        try { await jobs.touch?.(); } catch {}
      }).finally(() => {
        active -= 1;
        processQueue();
      });
    }
  }

  async function enqueue(url) {
    await jobs.cleanup?.();
    if (jobs.size >= maxJobs) throw new Error("Scan capacity is full. Try again later.");
    const now = new Date().toISOString();
    const job = { id: randomUUID(), shareToken: randomUUID(), url, status: "queued", stage: "queued", progress: 0, message: "검사 순서를 기다리고 있습니다.", createdAt: now, updatedAt: now, result: null, error: null };
    await jobs.set(job);
    queue.push(job);
    processQueue();
    return job;
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && requestUrl.pathname === "/healthz") {
        return json(res, 200, { ok: true, active, queued: queue.length });
      }
      if (req.method === "GET" && requestUrl.pathname === "/") return html(res, 200, landingPage());
      if (req.method === "POST" && requestUrl.pathname === "/api/scans") {
        const body = await readJsonBody(req);
        const target = validateCustomerTarget(body.url);
        const limit = rateLimiter?.consume(clientKey(req));
        if (limit && !limit.allowed) {
          return json(res, 429, {
            error: "Too many scan requests. Try again later.",
            retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000),
          });
        }
        const job = await enqueue(target);
        return json(res, 202, publicJob(job));
      }
      const apiMatch = requestUrl.pathname.match(/^\/api\/scans\/([0-9a-f-]+)$/u);
      if (req.method === "GET" && apiMatch) {
        const job = jobs.get(apiMatch[1]);
        return job ? json(res, 200, publicJob(job)) : json(res, 404, { error: "Scan not found" });
      }
      const jsonReportMatch = requestUrl.pathname.match(/^\/api\/scans\/([0-9a-f-]+)\/report\.json$/u);
      if (req.method === "GET" && jsonReportMatch) {
        const job = jobs.get(jsonReportMatch[1]);
        if (!job || job.status !== "completed" || !job.result?.report) return json(res, 404, { error: "Completed report not found" });
        return attachment(res, 200, job.result.report, "application/json; charset=utf-8", `vibecheck-${job.id}.json`);
      }
      const htmlReportMatch = requestUrl.pathname.match(/^\/results\/([0-9a-f-]+)\/report\.html$/u);
      if (req.method === "GET" && htmlReportMatch) {
        const job = jobs.get(htmlReportMatch[1]);
        if (!job || job.status !== "completed" || typeof job.result?.reportHtml !== "string") return html(res, 404, shell("Not found", "<h1>Completed report not found</h1>"));
        return attachment(res, 200, job.result.reportHtml, "text/html; charset=utf-8", `vibecheck-${job.id}.html`);
      }
      const resultMatch = requestUrl.pathname.match(/^\/results\/([0-9a-f-]+)$/u);
      if (req.method === "GET" && resultMatch) {
        const job = jobs.get(resultMatch[1]);
        if (!job) return html(res, 404, shell("Not found", "<h1>Scan not found</h1>"));
        if (job.status === "completed") return html(res, 200, completedPage(job));
        return html(res, job.status === "failed" ? 500 : 200, pendingPage(job));
      }
      const shareMatch = requestUrl.pathname.match(/^\/share\/([0-9a-f-]+)$/u);
      if (req.method === "GET" && shareMatch) {
        const job = [...jobs.values()].find((value) => value.shareToken === shareMatch[1]);
        if (!job) return html(res, 404, shell("Not found", "<h1>Shared scan not found</h1>"));
        if (job.status === "completed") return html(res, 200, completedPage(job));
        return html(res, job.status === "failed" ? 500 : 200, pendingPage(job));
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const status = /valid HTTPS|Only HTTPS|credentials|Custom ports|invalid JSON|body too large/u.test(error.message) ? 400 : /capacity/u.test(error.message) ? 429 : 500;
      return json(res, status, { error: error.message });
    }
  });

  return Object.freeze({
    server,
    jobs,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}
