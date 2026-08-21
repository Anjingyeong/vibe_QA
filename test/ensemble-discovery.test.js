import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdaptiveDiscoveryAdapter,
  createFreeDiscoveryAdapterFromEnv,
  discoveryCoverageSatisfied,
  mergeDiscoveryCandidates,
  sanitizeDiscoverySnapshot,
} from "../src/discovery/ensemble-discovery.js";
import { runAiDiscovery } from "../src/discovery/ai-discovery.js";

function candidate(action, expectation, extra = {}) {
  return { action, expectation, rationale: `Check ${expectation}`, confidence: 0.8, ...extra };
}

function response(candidates, status = 200) {
  if (status !== 200) return new Response("rate limited", { status });
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ candidates }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("snapshot sanitizer redacts structural and inline secrets before provider calls", () => {
  const sanitized = sanitizeDiscoverySnapshot({
    url: "https://example.com",
    password: "do-not-send",
    pages: [{ title: "token=super-secret-value", cookie: "session=abc" }],
  });
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.pages[0].cookie, "[REDACTED]");
  assert.match(sanitized.pages[0].title, /\[REDACTED\]/u);
  assert.doesNotMatch(JSON.stringify(sanitized), /super-secret-value|do-not-send|session=abc/u);
});

test("candidate merge deduplicates model overlap while preserving new coverage", () => {
  const a = candidate("click", "Menu opens", { selector: "#menu" });
  const b = candidate("inspect", "Search exists", { selector: "#search" });
  const merged = mergeDiscoveryCandidates([[a], [structuredClone(a), b]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].expectation, "Search exists");
});

test("adaptive ensemble stops after the first model when coverage is sufficient", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, model: body.model });
    return response([
      candidate("click", "Primary navigation opens", { selector: "nav button" }),
      candidate("fill", "Search accepts input", { selector: "input[type=search]" }),
      candidate("inspect", "Main content remains visible"),
    ]);
  };
  const adapter = createFreeDiscoveryAdapterFromEnv({ GROQ_API_KEY: "test-groq-key" }, { fetchImpl });
  const result = await runAiDiscovery(adapter, {
    url: "https://example.com",
    pages: [{ buttons: [1, 2, 3, 4, 5], forms: [], links: [] }],
  }, { maxCandidates: 24 });

  assert.equal(result.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
});

test("Groq quota or outage falls through all Groq models to Gemini", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, model: body.model });
    if (url.startsWith("https://api.groq.com/")) return response([], 429);
    return response([candidate("inspect", "Landing page structure is coherent")]);
  };
  const adapter = createFreeDiscoveryAdapterFromEnv({
    GROQ_API_KEY: "test-groq-key",
    GEMINI_API_KEY: "test-gemini-key",
  }, { fetchImpl });
  const result = await runAiDiscovery(adapter, { url: "https://example.com", pages: [] }, { maxCandidates: 24 });

  assert.equal(result.length, 1);
  assert.deepEqual(calls.map((item) => item.model), [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "qwen/qwen3.6-27b",
    "gemini-3.7-flash",
  ]);
  assert.match(calls.at(-1).url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/u);
});

test("invalid AI self-confirmation is discarded and a later provider can recover", async () => {
  const providers = [
    { name: "bad", model: "bad", adapter: { discover: async () => [candidate("inspect", "x", { severity: "critical" })] } },
    { name: "good", model: "good", adapter: { discover: async () => [candidate("inspect", "Safe candidate")]} },
  ];
  const adapter = createAdaptiveDiscoveryAdapter({ providers });
  const result = await runAiDiscovery(adapter, { pages: [] });
  assert.equal(result.length, 1);
  assert.equal(result[0].expectation, "Safe candidate");
  assert.equal("severity" in result[0], false);
});

test("coverage heuristic asks for more models only on interaction-heavy snapshots", () => {
  assert.equal(discoveryCoverageSatisfied([candidate("inspect", "x")], { pages: [] }), true);
  assert.equal(discoveryCoverageSatisfied([
    candidate("inspect", "x"),
    candidate("inspect", "y"),
    candidate("inspect", "z"),
  ], { pages: [{ buttons: [1,2,3,4,5,6,7,8], forms: [], links: [1,2,3,4] }] }), false);
});
