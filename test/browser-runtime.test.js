import test from "node:test";
import assert from "node:assert/strict";
import { chromiumLaunchOptions, defaultBrowserChannel } from "../src/runtime/browser-runtime.js";

test("browser runtime uses installed Edge on Windows and bundled Chromium elsewhere", () => {
  assert.equal(defaultBrowserChannel("win32"), "msedge");
  assert.equal(defaultBrowserChannel("linux"), null);
  assert.equal(defaultBrowserChannel("darwin"), null);
  assert.deepEqual(chromiumLaunchOptions({ browserChannel: "msedge" }), { channel: "msedge", headless: true });
  assert.deepEqual(chromiumLaunchOptions({ browserChannel: null }), { headless: true });
});
