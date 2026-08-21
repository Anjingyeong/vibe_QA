import { createNoopDiscoveryAdapter, runAiDiscovery } from "./ai-discovery.js";
import { createDiscoveryAdapterFromEnv } from "./openai-compatible.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_GROQ_MODELS = Object.freeze([
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3.6-27b",
]);
const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

function redactText(value, max = 500) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(?:sk|gsk|AIza)[-_A-Za-z0-9]{12,}/gu, "[REDACTED]")
    .replace(/((?:bearer|authorization|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu, "$1[REDACTED]")
    .slice(0, max);
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (/password|passwd|secret|token|authorization|cookie|api[_-]?key/iu.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeValue(item, depth + 1);
  }
  return output;
}

export function sanitizeDiscoverySnapshot(snapshot) {
  return sanitizeValue(structuredClone(snapshot ?? {}));
}

function candidateKey(candidate) {
  const action = candidate?.action ?? "";
  const selector = candidate?.selector ?? "";
  const url = candidate?.url ?? "";
  const expectation = String(candidate?.expectation ?? "").trim().toLowerCase();
  return `${action}\u0000${selector}\u0000${url}\u0000${expectation}`;
}

export function mergeDiscoveryCandidates(groups, { maxCandidates = 24 } = {}) {
  const merged = [];
  const seen = new Set();
  for (const group of groups ?? []) {
    for (const candidate of group ?? []) {
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
      if (merged.length >= maxCandidates) return merged;
    }
  }
  return merged;
}

function interactionCount(snapshot) {
  return (snapshot?.pages ?? []).reduce((sum, page) => (
    sum
    + (Array.isArray(page?.buttons) ? page.buttons.length : 0)
    + (Array.isArray(page?.forms) ? page.forms.length : 0)
    + Math.min(Array.isArray(page?.links) ? page.links.length : 0, 12)
  ), 0);
}

export function discoveryCoverageSatisfied(candidates, snapshot) {
  const interactions = interactionCount(snapshot);
  if (interactions === 0) return candidates.length >= 1;
  const target = Math.min(8, Math.max(3, Math.ceil(interactions * 0.3)));
  if (candidates.length < target) return false;
  if (interactions < 4) return true;
  return new Set(candidates.map((item) => item?.action).filter(Boolean)).size >= 2;
}

function parseModels(value, fallback) {
  if (!value) return [...fallback];
  const models = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return models.length ? models : [...fallback];
}

function createProvider({ name, baseUrl, apiKey, model, fetchImpl, timeoutMs }) {
  const adapter = createDiscoveryAdapterFromEnv({
    VIBECHECK_AI_BASE_URL: baseUrl,
    VIBECHECK_AI_API_KEY: apiKey,
    VIBECHECK_AI_MODEL: model,
    VIBECHECK_AI_TIMEOUT_MS: String(timeoutMs),
  }, { fetchImpl });
  return Object.freeze({ name, model, adapter });
}

export function createAdaptiveDiscoveryAdapter({
  providers = [],
  maxCandidates = 24,
  sanitize = sanitizeDiscoverySnapshot,
} = {}) {
  if (!Array.isArray(providers)) throw new Error("providers must be an array");
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 50) throw new Error("maxCandidates must be 1..50");

  return Object.freeze({
    async discover(snapshot) {
      if (providers.length === 0) return [];
      const safeSnapshot = sanitize(snapshot);
      const groups = [];
      let merged = [];

      for (const provider of providers) {
        try {
          const candidates = await runAiDiscovery(provider.adapter, safeSnapshot, { maxCandidates: 12 });
          groups.push(candidates);
          merged = mergeDiscoveryCandidates(groups, { maxCandidates });
          if (discoveryCoverageSatisfied(merged, safeSnapshot)) break;
        } catch {
          // AI discovery is optional. Provider quota/outage must never fail deterministic QA.
        }
      }
      return merged;
    },
  });
}

export function createFreeDiscoveryAdapterFromEnv(env = process.env, { fetchImpl = fetch } = {}) {
  const timeoutMs = Number(env.VIBECHECK_AI_TIMEOUT_MS ?? 20_000);
  const providers = [];

  if (env.GROQ_API_KEY) {
    for (const model of parseModels(env.VIBECHECK_GROQ_MODELS, DEFAULT_GROQ_MODELS)) {
      providers.push(createProvider({
        name: "groq",
        baseUrl: env.VIBECHECK_GROQ_BASE_URL ?? GROQ_BASE_URL,
        apiKey: env.GROQ_API_KEY,
        model,
        fetchImpl,
        timeoutMs,
      }));
    }
  }

  if (env.GEMINI_API_KEY) {
    providers.push(createProvider({
      name: "gemini",
      baseUrl: env.VIBECHECK_GEMINI_BASE_URL ?? GEMINI_BASE_URL,
      apiKey: env.GEMINI_API_KEY,
      model: env.VIBECHECK_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      fetchImpl,
      timeoutMs,
    }));
  }

  if (providers.length === 0) return createNoopDiscoveryAdapter();
  return createAdaptiveDiscoveryAdapter({ providers });
}

export function createDiscoveryStackFromEnv(env = process.env, options = {}) {
  if (env.GROQ_API_KEY || env.GEMINI_API_KEY) return createFreeDiscoveryAdapterFromEnv(env, options);
  return createDiscoveryAdapterFromEnv(env, options);
}

export const FREE_DISCOVERY_DEFAULTS = Object.freeze({
  groqBaseUrl: GROQ_BASE_URL,
  groqModels: DEFAULT_GROQ_MODELS,
  geminiBaseUrl: GEMINI_BASE_URL,
  geminiModel: DEFAULT_GEMINI_MODEL,
});
