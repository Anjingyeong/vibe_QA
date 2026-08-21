export function createSlidingWindowRateLimiter({
  limit = 5,
  windowMs = 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be positive");
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new Error("windowMs must be at least 1000");
  const buckets = new Map();

  return Object.freeze({
    consume(key) {
      const id = String(key || "unknown");
      const cutoff = now() - windowMs;
      const recent = (buckets.get(id) ?? []).filter((stamp) => stamp > cutoff);
      if (recent.length >= limit) {
        const retryAfterMs = Math.max(1, recent[0] + windowMs - now());
        buckets.set(id, recent);
        return { allowed: false, remaining: 0, retryAfterMs };
      }
      recent.push(now());
      buckets.set(id, recent);
      return { allowed: true, remaining: Math.max(0, limit - recent.length), retryAfterMs: 0 };
    },
    cleanup() {
      const cutoff = now() - windowMs;
      for (const [key, stamps] of buckets) {
        const recent = stamps.filter((stamp) => stamp > cutoff);
        if (recent.length) buckets.set(key, recent);
        else buckets.delete(key);
      }
    },
  });
}

export function requestClientKey(req) {
  const cloudflare = req.headers["cf-connecting-ip"];
  if (typeof cloudflare === "string" && cloudflare.trim()) return cloudflare.trim();
  return req.socket?.remoteAddress ?? "unknown";
}
