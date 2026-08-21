import test from "node:test";
import assert from "node:assert/strict";
import { classifyPreflight } from "../src/shadow/preflight.js";
import { classifyConsoleMessage } from "../src/scanner/browser-scanner.js";

test("shadow preflight separates public, protected, and unavailable targets", () => {
  assert.equal(classifyPreflight({ status: 200 }).kind, "public");
  assert.equal(classifyPreflight({ status: 302, location: "/login?return=%2F" }).kind, "protected");
  assert.equal(classifyPreflight({ status: 522 }).kind, "unavailable");
});

test("Cloudflare analytics CSP noise is not promoted to a major app failure", () => {
  const result = classifyConsoleMessage(
    "Loading the script 'https://static.cloudflareinsights.com/beacon.min.js' violates the following Content Security Policy directive"
  );
  assert.equal(result.kind, "telemetry-csp");
  assert.equal(result.severity, "minor");
});

test("ordinary application console errors remain major", () => {
  const result = classifyConsoleMessage("Uncaught TypeError: Cannot read properties of undefined");
  assert.equal(result.kind, "console-error");
  assert.equal(result.severity, "major");
});