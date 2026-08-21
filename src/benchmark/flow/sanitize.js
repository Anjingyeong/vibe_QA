const SECRET_KEYS = /^(?:authorization|auth|cookie|set-cookie|token|playerToken|roomCode|code|session|key)$/iu;
const STRUCTURAL = [
  [/(\/api\/rooms\/)[^/?#\s"']+/giu, "$1[REDACTED]"],
  [/(\/room\/)[^/?#\s"']+/giu, "$1[REDACTED]"],
  [/(bearer\s+)[^\s"']+/giu, "$1[REDACTED]"],
  [/(songsong:room-session:)[^\s"']+/giu, "$1[REDACTED]"],
  [/([?&](?:token|auth|key|code|session|cookie)=)[^&#\s"']+/giu, "$1[REDACTED]"],
];

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function createSanitizer() {
  const secrets = new Map();
  const register = (value, label = "secret") => {
    if (typeof value === "string" && value) secrets.set(value, label);
    return value;
  };
  const text = (input) => {
    let result = String(input ?? "");
    for (const [pattern, replacement] of STRUCTURAL) result = result.replace(pattern, replacement);
    for (const value of [...secrets.keys()].sort((a, b) => b.length - a.length)) {
      result = result.replace(new RegExp(escaped(value), "gu"), "[REDACTED]");
    }
    return result;
  };
  const clean = (value, seen = new WeakSet()) => {
    if (typeof value === "string") return text(value);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) {
      const output = value.map((item) => clean(item, seen));
      seen.delete(value);
      return output;
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : clean(item, seen);
    seen.delete(value);
    return output;
  };
  const assertSafe = (input) => {
    const serialized = typeof input === "string" ? input : JSON.stringify(input);
    for (const secret of secrets.keys()) {
      if (serialized.includes(secret)) throw new Error("artifact contains a registered secret");
    }
    const dangerous = [/(?:\/api\/rooms|\/room)\/[A-Z2-9]{6}\b/u,
      /"(?:authorization|auth|cookie|token|playerToken|roomCode)"\s*:\s*"(?!\[REDACTED\])/iu];
    if (dangerous.some((pattern) => pattern.test(serialized))) throw new Error("artifact contains an unredacted secret shape");
    return input;
  };
  const serialize = (value) => {
    const result = JSON.stringify(clean(value), null, 2);
    assertSafe(result);
    return result;
  };
  const values = () => [...secrets.keys()];
  return { register, text, clean, assertSafe, serialize, values };
}
