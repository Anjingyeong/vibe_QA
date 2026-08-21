export function classifyPreflight({ status, location = "" }) {
  if (status >= 200 && status < 300) {
    return { kind: "public", runnable: true };
  }

  if (status >= 300 && status < 400) {
    const loginLike = /(?:\/login\b|access\.cloudflare\.com)/i.test(location);
    return {
      kind: loginLike ? "protected" : "redirect",
      runnable: false,
      location,
    };
  }

  if (status >= 500) {
    return { kind: "unavailable", runnable: false, status };
  }

  return { kind: "unsupported", runnable: false, status };
}