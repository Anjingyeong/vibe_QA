import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { installPublicAuthorization } from "../explorer/site-explorer.js";
import { chromiumLaunchOptions, defaultBrowserChannel } from "../runtime/browser-runtime.js";

const PROFILES = [
  { name: "desktop", viewport: { width: 1280, height: 720 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true },
];

function observation({ signature, severity, title, reproduction, expected, actual, evidence }) {
  return { signature, severity, title, reproduction, expected, actual, evidence };
}

function screenshotEvidence(filePath) {
  return { type: "screenshot", detail: `Full-page screenshot: ${filePath}` };
}

export function shouldCaptureScreenshots({ platform = process.platform, arch = process.arch } = {}) {
  return !(platform === "linux" && arch === "arm64");
}

function evidenceWithShot(primary, shot) {
  return shot ? [...primary, shot] : primary;
}

export function classifyConsoleMessage(text) {
  if (
    /content security policy/i.test(text) &&
    /static\.cloudflareinsights\.com\/beacon/i.test(text)
  ) {
    return {
      kind: "telemetry-csp",
      severity: "minor",
      title: "Third-party analytics script blocked by CSP",
      expected: "Optional analytics should either be allowed by CSP or intentionally disabled without noisy browser errors.",
    };
  }

  return {
    kind: "console-error",
    severity: "major",
    title: "Browser console error",
    expected: "The launch page should load without application console errors.",
  };
}

export async function scanBrowser(baseUrl, {
  screenshotDir,
  browserChannel = defaultBrowserChannel(),
  targetPolicy = null,
  lookup,
  captureScreenshots = shouldCaptureScreenshots(),
} = {}) {
  if (!screenshotDir) throw new Error("screenshotDir is required for evidence-backed browser QA");
  await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch(chromiumLaunchOptions({ browserChannel }));
  const findings = [];
  const profileResults = [];

  try {
    for (const profile of PROFILES) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        isMobile: Boolean(profile.isMobile),
      });
      if (targetPolicy) {
        await installPublicAuthorization(context, targetPolicy, { ...(lookup ? { lookup } : {}) });
      }
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const badResponses = [];
      const origin = new URL(baseUrl).origin;

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        // Browser-generated resource failures belong to the network evidence lane.
        // Keeping them here would double-count 4xx/5xx responses and can turn an
        // automatic favicon request into a false application-console finding.
        if (/^Failed to load resource:/i.test(text)) return;
        consoleErrors.push(text);
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        const responseUrl = new URL(response.url());
        if (responseUrl.origin !== origin || response.status() < 400) return;
        badResponses.push({
          pathname: responseUrl.pathname,
          status: response.status(),
          resourceType: response.request().resourceType(),
        });
      });

      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(50);

      const layout = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        visualWidth: window.visualViewport?.width ?? null,
      }));
      let screenshotPath = null;
      let shot = null;
      if (captureScreenshots) {
        screenshotPath = path.join(screenshotDir, `${profile.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        shot = screenshotEvidence(screenshotPath);
      }

      if (consoleErrors.length > 0) {
        const groups = new Map();
        for (const text of consoleErrors) {
          const classification = classifyConsoleMessage(text);
          const group = groups.get(classification.kind) ?? {
            classification,
            messages: [],
          };
          group.messages.push(text);
          groups.set(classification.kind, group);
        }

        for (const { classification, messages } of groups.values()) {
          findings.push(observation({
            signature: `browser:${classification.kind}:${profile.name}`,
            severity: classification.severity,
            title: `${classification.title} on ${profile.name}`,
            reproduction: `Open ${baseUrl} in a ${profile.viewport.width}x${profile.viewport.height} browser viewport and inspect console errors.`,
            expected: classification.expected,
            actual: `${messages.length} matching console error(s) observed; first: ${messages[0]}`,
            evidence: evidenceWithShot([
              { type: "console", detail: messages.join(" | ") },
            ], shot),
          }));
        }
      }

      if (pageErrors.length > 0) {
        findings.push(observation({
          signature: `browser:page-error:${profile.name}`,
          severity: "major",
          title: `Uncaught page error on ${profile.name}`,
          reproduction: `Open ${baseUrl} in a ${profile.viewport.width}x${profile.viewport.height} browser viewport and observe uncaught page errors.`,
          expected: "The launch page should not throw uncaught runtime errors.",
          actual: `${pageErrors.length} uncaught error(s) observed; first: ${pageErrors[0]}`,
          evidence: evidenceWithShot([
            { type: "console", detail: pageErrors.join(" | ") },
          ], shot),
        }));
      }

      for (const bad of badResponses) {
        findings.push(observation({
          signature: `browser:http:${bad.pathname}:${bad.status}:${profile.name}`,
          severity: bad.resourceType === "document" ? "major" : "minor",
          title: `Browser resource returned HTTP ${bad.status} on ${profile.name}`,
          reproduction: `Open ${baseUrl} in the ${profile.name} profile and inspect the network response for ${bad.pathname}.`,
          expected: "Resources required by the rendered launch page should resolve without 4xx/5xx responses.",
          actual: `${bad.pathname} returned HTTP ${bad.status} as ${bad.resourceType}.`,
          evidence: evidenceWithShot([
            { type: "network", detail: `${bad.resourceType} GET ${bad.pathname} -> ${bad.status}` },
          ], shot),
        }));
      }

      if (layout.scrollWidth > layout.clientWidth + 1) {
        findings.push(observation({
          signature: `browser:horizontal-overflow:${profile.name}`,
          severity: "major",
          title: `Horizontal overflow on ${profile.name}`,
          reproduction: `Open ${baseUrl} at ${profile.viewport.width}px width and compare document scroll width to viewport width.`,
          expected: "The page should fit within the viewport without unintended horizontal scrolling.",
          actual: `Document width is ${layout.scrollWidth}px for a ${layout.clientWidth}px client viewport.`,
          evidence: evidenceWithShot([
            { type: "assertion", detail: `scrollWidth=${layout.scrollWidth}, clientWidth=${layout.clientWidth}, innerWidth=${layout.innerWidth}, visualWidth=${layout.visualWidth}` },
          ], shot),
        }));
      }

      profileResults.push({
        profile: profile.name,
        viewport: profile.viewport,
        consoleErrors,
        pageErrors,
        badResponses,
        layout,
        screenshotPath,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return {
    startedAt: new Date().toISOString(),
    baseUrl,
    findings,
    profiles: profileResults,
  };
}