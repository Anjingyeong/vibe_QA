const manifest = {
  version: "flow-trust-v1",
  requiredRunCount: 3,
  minimumConfirmations: 2,
  profiles: ["desktop", "mobile"],
  flows: [
    "first-load", "room-create", "room-join", "solo-start", "song-start",
    "answer-submit", "next-song", "duplicate-song", "refresh", "back",
    "invalid-input", "missing-route", "missing-api", "mobile-viewport",
    "runtime-errors", "cleanup",
  ],
  knownPositiveSignatures: [
    "flow:missing-route:desktop:failed",
    "flow:missing-route:mobile:failed",
    "flow:missing-api:desktop:failed",
    "flow:missing-api:mobile:failed",
  ],
  cleanControl: { fixture: "clean-browser-v1", runCount: 3 },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const FLOW_TRUST_MANIFEST = deepFreeze(manifest);
