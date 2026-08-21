import test from "node:test";
import assert from "node:assert/strict";
import { shouldCaptureScreenshots } from "../src/scanner/browser-scanner.js";

test("browser screenshots are disabled only on Linux ARM64", () => {
  assert.equal(shouldCaptureScreenshots({ platform: "linux", arch: "arm64" }), false);
  assert.equal(shouldCaptureScreenshots({ platform: "linux", arch: "x64" }), true);
  assert.equal(shouldCaptureScreenshots({ platform: "win32", arch: "arm64" }), true);
  assert.equal(shouldCaptureScreenshots({ platform: "darwin", arch: "arm64" }), true);
});
