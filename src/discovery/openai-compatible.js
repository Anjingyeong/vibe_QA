import { createNoopDiscoveryAdapter } from "./ai-discovery.js";

function stripFence(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : text;
}

function parseCandidates(content) {
  let parsed;
  try { parsed = JSON.parse(stripFence(content)); }
  catch { throw new Error("AI discovery provider returned invalid JSON"); }
  const candidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
  if (Array.isArray(candidates)) {
    return candidates.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      const confidence = candidate.confidence;
      if (Number.isFinite(confidence) && confidence > 1 && confidence <= 100) {
        return { ...candidate, confidence: confidence / 100 };
      }
      return candidate;
    });
  }
  throw new Error("AI discovery provider JSON must be an array or {candidates: []}");
}

export function createOpenAICompatibleDiscoveryAdapter({
  baseUrl,
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = 20_000,
} = {}) {
  if (!baseUrl || !apiKey || !model) throw new Error("baseUrl, apiKey, and model are required");
  const root = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (root.protocol !== "https:") throw new Error("AI baseUrl must use HTTPS");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error("timeoutMs must be 1000..60000");
  const endpoint = new URL("chat/completions", root).href;

  return Object.freeze({
    async discover(snapshot) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            messages: [
              {
                role: "system",
                content: "You are a QA test-case discovery assistant. Return JSON only. Propose at most 12 candidate checks for the supplied public web snapshot. Each candidate may contain only action, selector, url, valueHint, expectation, rationale, confidence. Allowed action values: navigate, click, fill, submit, inspect. If confidence is provided, use a decimal number from 0 to 1, never a percentage. Do not claim a bug, severity, evidence, actual result, signature, confirmation, or exploitability. These are unverified candidates that a deterministic browser harness may later accept or reject.",
              },
              {
                role: "user",
                content: JSON.stringify(snapshot),
              },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`AI discovery provider failed with HTTP ${response.status}`);
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("AI discovery provider returned no message content");
        return parseCandidates(content);
      } catch (error) {
        if (error?.name === "AbortError") throw new Error("AI discovery provider timed out");
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export function createDiscoveryAdapterFromEnv(env = process.env, options = {}) {
  const baseUrl = env.VIBECHECK_AI_BASE_URL;
  const apiKey = env.VIBECHECK_AI_API_KEY;
  const model = env.VIBECHECK_AI_MODEL;
  const configured = [baseUrl, apiKey, model].filter(Boolean).length;
  if (configured === 0) return createNoopDiscoveryAdapter();
  if (configured !== 3) throw new Error("VIBECHECK_AI_BASE_URL, VIBECHECK_AI_API_KEY, and VIBECHECK_AI_MODEL must be configured together");
  return createOpenAICompatibleDiscoveryAdapter({
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(env.VIBECHECK_AI_TIMEOUT_MS ?? 20_000),
    ...options,
  });
}
