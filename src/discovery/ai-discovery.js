const ALLOWED_ACTIONS = new Set(["navigate", "click", "fill", "submit", "inspect"]);

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateDiscoveryCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: ["candidate must be an object"] };
  }

  if (!ALLOWED_ACTIONS.has(candidate.action)) errors.push("action is invalid");
  if (!nonempty(candidate.expectation)) errors.push("expectation is required");
  if (!nonempty(candidate.rationale)) errors.push("rationale is required");
  if (candidate.selector != null && !nonempty(candidate.selector)) errors.push("selector must be non-empty when provided");
  if (candidate.url != null) {
    try {
      const url = new URL(candidate.url);
      if (!/^https?:$/u.test(url.protocol)) errors.push("url must use http or https");
    } catch {
      errors.push("url must be valid when provided");
    }
  }
  if (candidate.confidence != null && (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)) {
    errors.push("confidence must be between 0 and 1");
  }

  for (const forbidden of ["severity", "evidence", "confirmed", "confirmationCount", "actual", "signature"]) {
    if (forbidden in candidate) errors.push(`${forbidden} is forbidden in discovery candidates`);
  }

  return { ok: errors.length === 0, errors };
}

export async function runAiDiscovery(adapter, snapshot, { maxCandidates = 12 } = {}) {
  if (!adapter || typeof adapter.discover !== "function") throw new Error("AI discovery adapter must expose discover(snapshot)");
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 50) throw new Error("maxCandidates must be 1..50");

  const raw = await adapter.discover(Object.freeze(structuredClone(snapshot ?? {})));
  if (!Array.isArray(raw)) throw new Error("AI discovery adapter must return an array");

  return raw.slice(0, maxCandidates).map((candidate, index) => {
    const validation = validateDiscoveryCandidate(candidate);
    if (!validation.ok) throw new Error(`Invalid AI discovery candidate ${index}: ${validation.errors.join(", ")}`);
    return Object.freeze({
      source: "ai",
      status: "candidate",
      action: candidate.action,
      selector: candidate.selector ?? null,
      url: candidate.url ?? null,
      valueHint: candidate.valueHint ?? null,
      expectation: candidate.expectation.trim(),
      rationale: candidate.rationale.trim(),
      confidence: candidate.confidence ?? null,
    });
  });
}

export function createNoopDiscoveryAdapter() {
  return Object.freeze({
    async discover() {
      return [];
    },
  });
}
