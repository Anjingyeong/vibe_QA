import http from "node:http";

const SAFE_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:",
  "x-content-type-options": "nosniff",
};

const CASES = {
  "broken-v2": {
    html: `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hidden Launch App</title>
  <script>window.RUNTIME = { googleKey: "AIzaSyHiddenFixtureKey1234567890" };</script>
</head>
<body>
  <h1>Hidden Launch App</h1>
  <a href="/account">Account</a>
  <a href="/api/profile">Profile API</a>
  <a href="/api/status">Status API</a>
  <a href="/api/csrf">CSRF bootstrap</a>
  <form action="/api/register" method="post">
    <input name="email" type="email">
    <button type="submit">Register</button>
  </form>
  <img src="/logo.svg" alt="Hidden Launch App logo">
</body>
</html>`,
    handler(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/profile") {
        return sendJson(res, 200, {
          id: 7,
          displayName: "demo",
          accessToken: "live-user-token-should-not-be-public",
        });
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return sendJson(res, 503, { error: "dependency unavailable" });
      }
      if (req.method === "GET" && url.pathname === "/api/csrf") {
        return sendJson(res, 200, { csrfToken: "public-request-bound-token" });
      }
      if (req.method === "POST" && url.pathname === "/api/register") {
        return sendJson(res, 500, { error: "validation pipeline crashed" });
      }
      return false;
    },
  },
  "clean-v2": {
    html: `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clean Control App</title>
</head>
<body>
  <h1>Clean Control App</h1>
  <a href="/about">About</a>
  <a href="/api/csrf">CSRF bootstrap</a>
  <img src="/logo.svg" alt="Clean app logo">
</body>
</html>`,
    handler(req, res, url) {
      if (req.method === "GET" && url.pathname === "/about") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...SAFE_HEADERS });
        res.end("<!doctype html><html lang=\"ko\"><title>About</title><p>About</p></html>");
        return true;
      }
      if (req.method === "GET" && url.pathname === "/api/csrf") {
        sendJson(res, 200, { csrfToken: "public-request-bound-token" });
        return true;
      }
      return false;
    },
  },
};

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
  return true;
}

export async function startHiddenFixtureServer(caseId, port = 0) {
  const fixtureCase = CASES[caseId];
  if (!fixtureCase) throw new Error(`Unknown hidden fixture case: ${caseId}`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://hidden-fixture.local");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...SAFE_HEADERS });
      res.end(fixtureCase.html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/logo.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml", ...SAFE_HEADERS });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
      return;
    }

    if (await fixtureCase.handler(req, res, url)) return;

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