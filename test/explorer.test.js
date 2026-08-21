import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { authorizePublicSite, exploreSite, normalizeDiscoveredLinks } from "../src/explorer/site-explorer.js";

test("public-site policy rejects private and non-HTTPS targets by default", async () => {
  await assert.rejects(() => authorizePublicSite("http://example.com", { lookup: async () => [{ address: "93.184.216.34" }] }), /HTTPS/);
  await assert.rejects(() => authorizePublicSite("https://private.example", { lookup: async () => [{ address: "127.0.0.1" }] }), /public addresses/);
  await assert.rejects(() => authorizePublicSite("https://user:pass@example.com", { lookup: async () => [{ address: "93.184.216.34" }] }), /credentials are forbidden/);
});

test("link normalization stays same-origin and skips risky GET navigation", () => {
  const result = normalizeDiscoveredLinks("https://example.com/", [
    "/about",
    "/about#team",
    "https://example.com/docs?q=1",
    "https://other.example/path",
    "mailto:test@example.com",
    "/logout",
    "/account/delete?id=3",
  ]);
  assert.deepEqual(result.safe, ["https://example.com/about", "https://example.com/docs?q=1"]);
  assert.deepEqual(result.risky, ["https://example.com/logout", "https://example.com/account/delete?id=3"]);
});

test("bounded explorer discovers pages and interactions without submitting forms or risky links", async (t) => {
  let destructiveHits = 0;
  let submitHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/delete")) destructiveHits += 1;
    if (req.url.startsWith("/submit")) submitHits += 1;
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/about") {
      res.end("<html><title>About</title><body><a href='/'>Home</a></body></html>");
      return;
    }
    res.end("<html><title>Home</title><body><a href='/about'>About</a><a href='/delete?id=1'>Delete</a><form action='/submit' method='post'><input name='name'><button type='submit'>Send</button></form></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const result = await exploreSite(`http://127.0.0.1:${port}/`, { maxPages: 2, allowPrivateForTesting: true });
  assert.equal(result.pageCount, 2);
  assert.equal(result.coverage.formsObserved, 1);
  assert.equal(result.coverage.buttonsObserved, 1);
  assert.equal(result.coverage.skippedRiskyLinks, 1);
  assert.equal(destructiveHits, 0);
  assert.equal(submitHits, 0);
  assert.ok(result.pages.some((page) => page.url.endsWith("/about")));
});
