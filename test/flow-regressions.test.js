import test from "node:test";
import assert from "node:assert/strict";

async function loadRegressionClassifier() {
  try {
    return await import("../src/scanner/flow-regressions.js");
  } catch {
    return null;
  }
}

test("known third-party browser noise is retained but not overstated", async () => {
  const classifier = await loadRegressionClassifier();

  assert.ok(classifier, "flow regression classifier module must exist");
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "console",
      source: "",
      message: "Loading https://static.cloudflareinsights.com/beacon.min.js violates Content Security Policy",
    }),
    { classification: "telemetry-csp", severity: "minor", confirmable: false },
  );
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "console",
      source: "https://songsong.jingyeong.cloud/",
      message: "Permissions policy violation: compute-pressure is not allowed",
    }),
    { classification: "unsupported-permission", severity: "minor", confirmable: false },
  );
});

test("expected invalid-input responses are not promoted to findings", async () => {
  const classifier = await loadRegressionClassifier();

  assert.ok(classifier, "flow regression classifier module must exist");
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "response",
      url: "https://songsong.jingyeong.cloud/api/rooms/ZZZZZZ",
      status: 400,
      expectedStatus: 400,
    }),
    { classification: "expected-negative", severity: null, confirmable: false },
  );
});

test("soft missing routes remain machine-confirmable major findings", async () => {
  const classifier = await loadRegressionClassifier();

  assert.ok(classifier, "flow regression classifier module must exist");
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "response",
      url: "https://songsong.jingyeong.cloud/api/__vibecheck_missing__",
      status: 200,
      expectedStatus: 404,
      contentType: "text/html",
    }),
    { classification: "soft-404", severity: "major", confirmable: true },
  );
});

test("expected browser teardown aborts are retained as minor non-confirmable noise", async () => {
  const classifier = await loadRegressionClassifier();

  assert.ok(classifier, "flow regression classifier module must exist");
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "requestfailed",
      url: "https://www.youtube.com/embed/example",
      failure: "net::ERR_ABORTED",
    }),
    { classification: "media-navigation-abort", severity: "minor", confirmable: false },
  );
  assert.deepEqual(
    classifier.classifyRuntimeEvent({
      type: "requestfailed",
      url: "https://static.cloudflareinsights.com/beacon.min.js",
      failure: "csp",
    }),
    { classification: "telemetry-csp", severity: "minor", confirmable: false },
  );
});

test("expected response and console noise correlate by URL, not globally", async () => {
  const { triageRuntimeEvents } = await loadRegressionClassifier();
  const events = [
    { type: "response", url: "https://songsong.jingyeong.cloud/api/missing", status: 404, expectedStatus: 404 },
    { type: "console", source: "https://songsong.jingyeong.cloud/api/missing", message: "Failed to load resource: 404" },
    { type: "console", source: "https://songsong.jingyeong.cloud/app.js", message: "Failed to load resource: 500" },
  ];
  const result = triageRuntimeEvents(events);
  assert.equal(result.expected.length, 2);
  assert.deepEqual(result.unexpected, [events[2]]);
  assert.deepEqual(events[0], { type: "response", url: "https://songsong.jingyeong.cloud/api/missing",
    status: 404, expectedStatus: 404 }, "triage must be pure");
});
