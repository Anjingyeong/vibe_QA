const UNKNOWN = {
  classification: "unknown",
  severity: null,
  confirmable: false,
};

export function classifyRuntimeEvent(event) {
  if (!event || typeof event !== "object") return UNKNOWN;

  if (event.type === "console") {
    const source = typeof event.source === "string" ? event.source.toLowerCase() : "";
    const message = typeof event.message === "string" ? event.message.toLowerCase() : "";

    if (
      (source.includes("static.cloudflareinsights.com") ||
        message.includes("static.cloudflareinsights.com")) &&
      message.includes("content security policy")
    ) {
      return { classification: "telemetry-csp", severity: "minor", confirmable: false };
    }
    if (message.includes("permissions policy") && message.includes("compute-pressure")) {
      return { classification: "unsupported-permission", severity: "minor", confirmable: false };
    }
  }

  if (event.type === "response") {
    if (event.status === event.expectedStatus) {
      return { classification: "expected-negative", severity: null, confirmable: false };
    }
    if (event.status === 200 && event.expectedStatus === 404 && event.contentType === "text/html") {
      return { classification: "soft-404", severity: "major", confirmable: true };
    }
  }

  if (event.type === "requestfailed") {
    const url = typeof event.url === "string" ? event.url.toLowerCase() : "";
    const failure = typeof event.failure === "string" ? event.failure.toLowerCase() : "";
    const thirdPartyMedia = /(?:youtube\.com|googlevideo\.com|doubleclick\.net|cloudflare)/.test(url);

    if (url.includes("static.cloudflareinsights.com") && failure === "csp") {
      return { classification: "telemetry-csp", severity: "minor", confirmable: false };
    }
    if (thirdPartyMedia && (failure.includes("content security policy") || failure.includes("net::err_aborted"))) {
      return { classification: "media-navigation-abort", severity: "minor", confirmable: false };
    }
  }

  return UNKNOWN;
}

function eventUrl(event) {
  const value = event.type === "console" ? event.source : event.url;
  if (typeof value !== "string") return null;
  try { const url = new URL(value); url.hash = ""; return url.href; } catch { return value; }
}

export function triageRuntimeEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const expectedUrls = new Set(list.filter((event) =>
    event.type === "response" && classifyRuntimeEvent(event).classification === "expected-negative").map(eventUrl));
  const expected = [];
  const ignored = [];
  const unexpected = [];
  for (const event of list) {
    const classification = classifyRuntimeEvent(event);
    if (classification.classification === "expected-negative" ||
        (event.type === "console" && /^Failed to load resource:/iu.test(event.message ?? "") &&
          expectedUrls.has(eventUrl(event)))) {
      expected.push(event);
    } else if (classification.classification !== "unknown" && !classification.confirmable) {
      ignored.push(event);
    } else {
      unexpected.push(event);
    }
  }
  return { expected, ignored, unexpected };
}
