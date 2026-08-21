function finding({
  signature,
  severity,
  title,
  reproduction,
  expected,
  actual,
  type = "assertion",
  detail,
}) {
  return {
    signature,
    severity,
    title,
    reproduction,
    expected,
    actual,
    evidence: [{ type, detail }],
  };
}

function unique(values) {
  return [...new Set(values)];
}

function extractAttributeValues(html, tagPattern, attribute) {
  const results = [];
  const tagRegex = new RegExp(`<${tagPattern}\\b[^>]*>`, "gi");
  const attrRegex = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i");
  for (const match of html.matchAll(tagRegex)) {
    const attr = match[0].match(attrRegex);
    if (attr) results.push(attr[1]);
  }
  return results;
}

function collectSensitivePaths(value, path = "$") {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectSensitivePaths(item, `${path}[${index}]`));
    });
    return found;
  }
  if (!value || typeof value !== "object") return found;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const isRequestProtectionToken =
      normalizedKey.includes("csrftoken") || normalizedKey.includes("xsrftoken");
    const isCredentialLike =
      /(?:password|passwordhash|secret|apikey|privatekey)/i.test(normalizedKey) ||
      /(?:access|refresh|auth|bearer|session|id)token/i.test(normalizedKey);
    if (isCredentialLike && !isRequestProtectionToken) {
      found.push(childPath);
    }
    found.push(...collectSensitivePaths(child, childPath));
  }
  return found;
}

export async function scan(baseUrl) {
  const findings = [];
  const rootResponse = await fetch(`${baseUrl}/`);
  const html = await rootResponse.text();

  const secretPattern =
    /\b(?:sk-(?:proj|live|test)-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g;
  const secrets = html.match(secretPattern) ?? [];
  if (secrets.length > 0) {
    findings.push(
      finding({
        signature: "secret:html",
        severity: "critical",
        title: "Secret-like credential exposed in client HTML",
        reproduction: "GET / and inspect the returned HTML source.",
        expected: "Client HTML must not contain secret-like credentials.",
        actual: `Found ${secrets.length} secret-like credential pattern(s).`,
        detail: `Static response assertion matched a secret pattern (${secrets[0].slice(0, 12)}…).`,
      })
    );
  }

  if (!/<meta\b[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
    findings.push(
      finding({
        signature: "meta:viewport-missing",
        severity: "major",
        title: "Mobile viewport metadata is missing",
        reproduction: "GET / and inspect the document head.",
        expected: "A responsive launch page should declare a viewport meta tag.",
        actual: "No meta[name=viewport] tag was found.",
        detail: "Static HTML assertion: viewport meta count = 0.",
      })
    );
  }

  if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(html)) {
    findings.push(
      finding({
        signature: "html:lang-missing",
        severity: "minor",
        title: "Document language is not declared",
        reproduction: "GET / and inspect the root html element.",
        expected: "The html element should declare a language.",
        actual: "The html element has no lang attribute.",
        detail: "Static HTML assertion: html[lang] not found.",
      })
    );
  }

  const ids = extractAttributeValues(html, "[a-zA-Z0-9:-]+", "id");
  const duplicateIds = unique(ids.filter((id, index) => ids.indexOf(id) !== index));
  if (duplicateIds.length > 0) {
    findings.push(
      finding({
        signature: "dom:duplicate-id",
        severity: "minor",
        title: "Duplicate DOM id",
        reproduction: "GET / and inspect id attributes.",
        expected: "DOM id values should be unique within a document.",
        actual: `Duplicate id(s): ${duplicateIds.join(", ")}.`,
        detail: `Static HTML assertion found duplicate id(s): ${duplicateIds.join(", ")}.`,
      })
    );
  }

  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imageTags.filter(
    (tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)
  );
  if (missingAlt.length > 0) {
    findings.push(
      finding({
        signature: "a11y:image-alt-missing",
        severity: "minor",
        title: "Image is missing alt text",
        reproduction: "GET / and inspect img elements.",
        expected: "Images should provide an alt attribute, including empty alt for decorative images.",
        actual: `${missingAlt.length} image(s) have no alt attribute.`,
        detail: `Static HTML assertion: missing-alt image count = ${missingAlt.length}.`,
      })
    );
  }

  const resourceUrls = [
    ...extractAttributeValues(html, "script", "src"),
    ...extractAttributeValues(html, "link", "href"),
    ...extractAttributeValues(html, "img", "src"),
  ];
  const insecureResources = resourceUrls.filter((url) => /^http:\/\//i.test(url));
  if (insecureResources.length > 0) {
    findings.push(
      finding({
        signature: "resource:http-mixed-content",
        severity: "major",
        title: "Insecure HTTP subresource is referenced",
        reproduction: "GET / and inspect script/link/img resource URLs.",
        expected: "Launch pages should not reference insecure HTTP subresources.",
        actual: `Found insecure resource: ${insecureResources[0]}.`,
        detail: `Static resource assertion matched ${insecureResources[0]}.`,
      })
    );
  }

  const missingHeaders = ["content-security-policy", "x-content-type-options"].filter(
    (header) => !rootResponse.headers.has(header)
  );
  if (missingHeaders.length > 0) {
    findings.push(
      finding({
        signature: "headers:baseline-missing",
        severity: "major",
        title: "Baseline browser security headers are missing",
        reproduction: "GET / and inspect response headers.",
        expected: "The launch response should include baseline browser hardening headers.",
        actual: `Missing header(s): ${missingHeaders.join(", ")}.`,
        type: "network",
        detail: `GET / -> ${rootResponse.status}; missing ${missingHeaders.join(", ")}.`,
      })
    );
  }

  const hrefs = unique(extractAttributeValues(html, "a", "href"));
  for (const href of hrefs) {
    if (!href.startsWith("/")) continue;

    const response = await fetch(new URL(href, baseUrl));
    if (!href.startsWith("/api/") && response.status >= 400) {
      findings.push(
        finding({
          signature: `link:${href}:${response.status}`,
          severity: "major",
          title: "Internal link is broken",
          reproduction: `Open the page and follow ${href}.`,
          expected: "An internal navigation link should resolve successfully.",
          actual: `${href} returned HTTP ${response.status}.`,
          type: "network",
          detail: `GET ${href} -> ${response.status}.`,
        })
      );
    }

    if (href.startsWith("/api/") && response.status >= 500) {
      findings.push(
        finding({
          signature: `endpoint:${href}:${response.status}`,
          severity: "major",
          title: "Linked API endpoint returns server error",
          reproduction: `GET ${href}.`,
          expected: "A linked API endpoint should not return a 5xx response in the launch path.",
          actual: `${href} returned HTTP ${response.status}.`,
          type: "network",
          detail: `GET ${href} -> ${response.status}.`,
        })
      );
      continue;
    }

    if (href.startsWith("/api/") && response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const sensitivePaths = collectSensitivePaths(payload);
        if (sensitivePaths.length > 0) {
          findings.push(
            finding({
              signature: `json-sensitive:${href}`,
              severity: "critical",
              title: "Unauthenticated API leaks sensitive credential field",
              reproduction: `Request ${href} without authentication and inspect JSON keys.`,
              expected: "Unauthenticated API responses should not expose credential-like fields.",
              actual: `Sensitive key path(s) returned: ${sensitivePaths.join(", ")}.`,
              type: "network",
              detail: `GET ${href} -> ${response.status}; sensitive key path(s): ${sensitivePaths.join(", ")}.`,
            })
          );
        }
      }
    }
  }

  const formActions = unique(extractAttributeValues(html, "form", "action"));
  for (const action of formActions) {
    if (!action.startsWith("/")) continue;
    const response = await fetch(new URL(action, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    if (response.status >= 500) {
      findings.push(
        finding({
          signature: `form:${action}:${response.status}`,
          severity: "major",
          title: "Invalid form input causes server error",
          reproduction: `POST an empty JSON object to ${action}.`,
          expected: "Invalid user input should be rejected with a controlled 4xx response.",
          actual: `${action} returned HTTP ${response.status}.`,
          type: "network",
          detail: `POST ${action} with {} -> ${response.status}.`,
        })
      );
    }
  }

  return {
    startedAt: new Date().toISOString(),
    baseUrl,
    findings,
  };
}
