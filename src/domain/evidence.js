const ALLOWED_EVIDENCE_TYPES = new Set([
  "network",
  "console",
  "screenshot",
  "assertion",
]);

export function validateObservation(observation) {
  const errors = [];

  if (!observation || typeof observation !== "object") {
    return { ok: false, errors: ["observation must be an object"] };
  }

  for (const field of ["signature", "severity", "title", "reproduction", "expected", "actual"]) {
    if (typeof observation[field] !== "string" || observation[field].trim() === "") {
      errors.push(`${field} is required`);
    }
  }

  if (!Array.isArray(observation.evidence) || observation.evidence.length === 0) {
    errors.push("at least one evidence item is required");
  } else {
    for (const [index, item] of observation.evidence.entries()) {
      if (!item || typeof item !== "object") {
        errors.push(`evidence[${index}] must be an object`);
        continue;
      }
      if (!ALLOWED_EVIDENCE_TYPES.has(item.type)) {
        errors.push(`evidence[${index}].type is invalid`);
      }
      if (typeof item.detail !== "string" || item.detail.trim() === "") {
        errors.push(`evidence[${index}].detail is required`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
