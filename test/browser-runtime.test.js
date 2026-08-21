import test from "node:test";
import assert from "node:assert/strict";
import { chromiumLaunchOptions, defaultBrowserChannel } from "../src/runtime/browser-runtime.js";

test("browser runtime uses Edge on Windows and Chromium new headless mode on Linux", () => {
  assert.equal(defaultBrowserChannel("win32"), "msedge");
  assert.equal(defaultBrowserChannel("linux"), "chromium");
  assert.equal(defaultBrowserChannel("darwin"), null);
  assert.deepEqual(chromiumLaunchOptions({ browserChannel: "msedge" }), { channel: "msedge", headless: true });
  assert.deepEqual(chromiumLaunchOptions({ browserChannel: "chromium" }), { channel: "chromium", headless: true });
  assert.deepEqual(chromiumLaunchOptions({ browserChannel: null }), { headless: true });
});
