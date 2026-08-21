import test from "node:test";
import assert from "node:assert/strict";
import { createNoopDiscoveryAdapter, runAiDiscovery, validateDiscoveryCandidate } from "../src/discovery/ai-discovery.js";

test("AI discovery stays candidate-only and provider agnostic", async () => {
  const adapter = {
    async discover(snapshot) {
      assert.equal(snapshot.url, "https://example.com");
      return [{
        action: "click",
        selector: "button[type=submit]",
        expectation: "Submitting the form should produce a deterministic state change.",
        rationale: "Primary submit control is visible.",
        confidence: 0.8,
      }];
    },
  };

  const result = await runAiDiscovery(adapter, { url: "https://example.com" });
  assert.deepEqual(result, [{
    source: "ai",
    status: "candidate",
    action: "click",
    selector: "button[type=submit]",
    url: null,
    valueHint: null,
    expectation: "Submitting the form should produce a deterministic state change.",
    rationale: "Primary submit control is visible.",
    confidence: 0.8,
  }]);
});

test("AI discovery rejects attempts to self-confirm findings", async () => {
  const invalid = {
    action: "inspect",
    expectation: "No error should occur.",
    rationale: "Inspect runtime behavior.",
    severity: "critical",
    evidence: [{ type: "console", detail: "invented" }],
    confirmed: true,
  };
  const validation = validateDiscoveryCandidate(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" | "), /severity is forbidden/);
  assert.match(validation.errors.join(" | "), /evidence is forbidden/);
  assert.match(validation.errors.join(" | "), /confirmed is forbidden/);
  await assert.rejects(() => runAiDiscovery({ async discover() { return [invalid]; } }, {}), /Invalid AI discovery candidate/);
});

test("noop discovery requires no model or network", async () => {
  assert.deepEqual(await runAiDiscovery(createNoopDiscoveryAdapter(), { arbitrary: true }), []);
});
