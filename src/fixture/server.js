import http from "node:http";
import { fileURLToPath } from "node:url";

const HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Seeded Vibe Shop</title>
  <script src="http://example.com/insecure.js"></script>
  <script>window.__APP_CONFIG__ = { apiKey: "sk-proj-vibecheck-demo-secret-1234567890" };</script>
</head>
<body>
  <h1>Seeded Vibe Shop</h1>
  <nav>
    <a href="/dashboard">Dashboard</a>
    <a href="/api/users">Users API</a>
    <a href="/api/health">Health API</a>
  </nav>
  <form action="/api/login" method="post">
    <input name="email" type="email">
    <button type="submit">Login</button>
  </form>
  <div id="cta">First CTA</div>
  <div id="cta">Duplicate CTA</div>
  <img src="/logo.svg">
</body>
</html>`;

function sendJson(res, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function createFixtureServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.local");

    if (req.method === "GET" && url.pathname === "/") {
      // Intentionally omit CSP and X-Content-Type-Options for the benchmark fixture.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/logo.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      sendJson(
        res,
        200,
        [{ id: 1, email: "demo@example.com", passwordHash: "$2b$demo-hash" }],
        { "access-control-allow-origin": "*" }
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 500, { error: "database unavailable" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed = null;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = null;
      }

      if (!parsed?.email || !parsed?.password) {
        sendJson(res, 500, { error: "Cannot read property 'email' of undefined" });
        return;
      }

      sendJson(res, 401, { error: "invalid credentials" });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}

export async function startFixtureServer(port = 0) {
  const server = createFixtureServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startFixtureServer(Number(process.env.PORT ?? 4177));
  console.log(`Seeded fixture listening on ${fixture.baseUrl}`);
}
