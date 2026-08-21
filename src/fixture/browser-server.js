import http from "node:http";

const SAFE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
  "x-content-type-options": "nosniff",
};

const BROKEN_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Broken Fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    .shell { padding: 20px; }
    .wide-card { width: 900px; height: 80px; border: 1px solid #999; }
  </style>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      console.error('VIBECHECK_RUNTIME_ERROR: hydration failed');
      setTimeout(() => { throw new Error('VIBECHECK_BOOTSTRAP_CRASH'); }, 0);
    });
  </script>
</head>
<body>
  <main class="shell">
    <h1>Browser Broken Fixture</h1>
    <div class="wide-card">This card intentionally overflows on mobile.</div>
    <img src="/missing.png" alt="Intentionally missing fixture image">
  </main>
</body>
</html>`;

const CLEAN_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Clean Fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    main { max-width: 720px; padding: 20px; margin: auto; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <main>
    <h1>Browser Clean Fixture</h1>
    <p>Nothing should fail in this control.</p>
    <img src="/ok.svg" alt="Control fixture mark">
  </main>
</body>
</html>`;

const HTML_BY_CASE = {
  "broken-browser-v1": BROKEN_HTML,
  "clean-browser-v1": CLEAN_HTML,
};

export async function startBrowserFixtureServer(caseId, port = 0) {
  const html = HTML_BY_CASE[caseId];
  if (!html) throw new Error(`Unknown browser fixture case: ${caseId}`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://browser-fixture.local");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...SAFE_HEADERS });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/ok.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml", ...SAFE_HEADERS });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>');
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SAFE_HEADERS });
    res.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    caseId,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}