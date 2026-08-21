import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { authorizeTarget, authorizeRequest } from "../src/benchmark/flow/target-policy.js";
import { createSanitizer } from "../src/benchmark/flow/sanitize.js";
import { captureScreenshot } from "../src/benchmark/flow/screenshot.js";
import { validateFinding, validateRunFindings } from "../src/benchmark/flow/evidence.js";
import { validateCleanup } from "../src/benchmark/flow/cleanup.js";
const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

test("target policy is exact HTTPS allowlist and rejects SSRF destinations", async () => {
  assert.equal((await authorizeTarget(undefined, { lookup: PUBLIC })).origin, "https://songsong.jingyeong.cloud");
  for (const target of ["http://songsong.jingyeong.cloud", "https://user:pass@songsong.jingyeong.cloud",
    "https://songsong.jingyeong.cloud:444", "https://songsong.jingyeong.cloud/base",
    "https://127.0.0.1", "https://169.254.169.254", "https://[::1]"]) {
    await assert.rejects(authorizeTarget(target, { allowHosts: [new URL(target).hostname], lookup: PUBLIC }));
  }
  await assert.rejects(authorizeTarget("https://evil.example", { lookup: PUBLIC }), /allowlist/i);
  await assert.rejects(authorizeTarget("https://public.example", { allowHosts: ["public.example"],
    lookup: async () => [{ address: "10.0.0.2", family: 4 }] }), /public/i);
});

test("every HTTP request and redirect is reauthorized", async () => {
  const policy = await authorizeTarget("https://public.example", { allowHosts: ["public.example"], lookup: PUBLIC });
  await authorizeRequest("https://public.example/image.png", policy, { lookup: PUBLIC });
  await authorizeRequest("https://cdn.example/player.js", policy, { lookup: PUBLIC });
  await assert.rejects(authorizeRequest("http://public.example/image.png", policy, { lookup: PUBLIC }));
  await assert.rejects(authorizeRequest("https://127.0.0.1/metadata", policy, { lookup: PUBLIC }));
  await assert.rejects(authorizeRequest("https://other.example/redirect", policy,
    { lookup: PUBLIC, mainFrameNavigation: true }));
});

test("recursive serialization redacts registered and structural secrets and fails closed", () => {
  const sanitizer = createSanitizer();
  sanitizer.register("ABC234", "room-code"); sanitizer.register("player-secret", "player-token");
  const clean = sanitizer.serialize({ url: "https://example.test/api/rooms/ABC234?auth=player-secret",
    nested: [{ roomCode: "ABC234", cookie: "session=player-secret" }] });
  assert.doesNotMatch(clean, /ABC234|player-secret/);
  assert.throws(() => sanitizer.assertSafe("prefixABC234suffix"), /secret/i);
  sanitizer.register("tok.en+value", "regex-token");
  assert.doesNotMatch(sanitizer.serialize({ tokenValue: "tok.en+value" }), /tok\.en\+value/u);
});

test("screenshot helper masks credentials and stores a relative path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-shot-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 240, height: 120 } });
    await page.setContent('<style>body{margin:0}.secret{background:#f00;width:120px;height:60px}</style><div class="secret">ABC234</div>');
    const relative = await captureScreenshot(page, root, "shots/masked.png", [], ["ABC234"]);
    assert.equal(relative, "shots/masked.png");
    const bytes = await readFile(path.join(root, relative));
    assert.equal(bytes.includes(Buffer.from("ABC234")), false);
    const pixel = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return [...context.getImageData(10, 10, 1, 1).data];
    }, bytes.toString("base64"));
    assert.deepEqual(pixel, [0, 0, 0, 255], "credential area must be deterministically black-masked");
    await assert.rejects(captureScreenshot(page, root, "../escape.png", []), /artifact root/i);
  } finally { await browser.close(); }
});

test("canonical evidence rejects malformed, duplicates, inconsistency, and unsafe screenshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-evidence-"));
  const finding = { signature: "sig", severity: "major", title: "title", reproduction: ["step"],
    expected: "good", actual: "bad", screenshot: "shot.png",
    machineEvidence: [{ type: "network", detail: "GET / -> 500" }] };
  await assert.rejects(validateFinding(finding, { artifactRoot: root }), /screenshot/i);
  await writeFile(path.join(root, "shot.png"), "png");
  await assert.rejects(validateFinding({ ...finding, machineEvidence: [{ type: "mystery", detail: "x" }] },
    { artifactRoot: root }), /type/i);
  await assert.rejects(validateFinding({ ...finding, machineEvidence: [{ type: "network", detail: 42 }] },
    { artifactRoot: root }), /detail/i);
  await assert.rejects(validateRunFindings([finding, finding], { artifactRoot: root }), /duplicate/i);
  await assert.rejects(validateRunFindings([{ ...finding, signature: "sig2", expected: "other" }],
    { artifactRoot: root, identities: new Map([["sig2", finding]]) }), /inconsistent/i);
  await assert.rejects(validateFinding({ ...finding, screenshot: "../shot.png" }, { artifactRoot: root }), /root/i);
});

test("fallback cleanup validates deletion and redacts failures", async () => {
  assert.equal((await validateCleanup(async () => ({ status: 204 }), { code: "ABC234", token: "secret" })).status, 204);
  await assert.rejects(validateCleanup(async () => ({ status: 500, body: "ABC234 secret" }),
    { code: "ABC234", token: "secret" }),
  (error) => !/ABC234|secret/.test(error.message) && /cleanup/i.test(error.message));
});

test("runner source contains no production report mutation", async () => {
  const source = await readFile(new URL("../src/benchmark/run-flow-browser.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /media-reports/);
});
