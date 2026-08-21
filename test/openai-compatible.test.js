import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryAdapterFromEnv, createOpenAICompatibleDiscoveryAdapter } from "../src/discovery/openai-compatible.js";
import { runAiDiscovery } from "../src/discovery/ai-discovery.js";

test("OpenAI-compatible discovery adapter parses candidate JSON without gaining confirmation authority", async () => {
  let request;
  const adapter = createOpenAICompatibleDiscoveryAdapter({
    baseUrl: "https://ai.example.test/v1/",
    apiKey: "test-key",
    model: "qa-model",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify([{ action: "inspect", expectation: "Search field is visible", rationale: "Core navigation control", confidence: 0.8 }]) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const candidates = await runAiDiscovery(adapter, { url: "https://example.com/", pages: [] });
  assert.equal(request.url, "https://ai.example.test/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "candidate");
  assert.equal("confirmed" in candidates[0], false);
});

test("OpenAI-compatible adapter rejects provider attempts to self-confirm", async () => {
  const adapter = createOpenAICompatibleDiscoveryAdapter({
    baseUrl: "https://ai.example.test/v1/",
    apiKey: "test-key",
    model: "qa-model",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ action: "inspect", expectation: "x", rationale: "y", severity: "critical" }]) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => runAiDiscovery(adapter, { url: "https://example.com/" }), /severity is forbidden/);
});

test("OpenAI-compatible adapter normalizes percentage confidence to the 0..1 contract", async () => {
  const adapter = createDiscoveryAdapterFromEnv({
    VIBECHECK_AI_BASE_URL: "https://ai.example.test/v1/",
    VIBECHECK_AI_API_KEY: "test-key",
    VIBECHECK_AI_MODEL: "qa-model",
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ action: "inspect", expectation: "x", rationale: "y", confidence: 90 }]) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const candidates = await runAiDiscovery(adapter, { url: "https://example.com/" });
  assert.equal(candidates[0].confidence, 0.9);
});

test("AI environment configuration is opt-in and fails closed when partial", async () => {
  const noop = createDiscoveryAdapterFromEnv({});
  assert.deepEqual(await noop.discover({}), []);
  assert.throws(() => createDiscoveryAdapterFromEnv({ VIBECHECK_AI_MODEL: "x" }), /must be configured together/);
});
