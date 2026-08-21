import dns from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright";
import { isPublicAddress } from "../benchmark/flow/target-policy.js";
import { chromiumLaunchOptions, defaultBrowserChannel } from "../runtime/browser-runtime.js";

const RISKY_NAVIGATION = /(?:logout|log-out|signout|sign-out|delete|remove|destroy|unsubscribe|purchase|checkout|payment|\bpay\b)/iu;

async function resolveHost(hostname, lookup) {
  if (net.isIP(hostname)) return [{ address: hostname }];
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`target DNS resolution failed: ${error.code ?? "unknown"}`);
  }
}

export async function authorizePublicSite(value, { lookup = dns.lookup, allowPrivateForTesting = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error("target must be a valid URL"); }
  const testHttp = allowPrivateForTesting && url.protocol === "http:";
  if (url.protocol !== "https:" && !testHttp) throw new Error("target must use HTTPS");
  if (url.username || url.password) throw new Error("target URL credentials are forbidden");
  if (!allowPrivateForTesting && url.port) throw new Error("target must use the default HTTPS port");
  url.hash = "";

  const addresses = await resolveHost(url.hostname, lookup);
  if (!addresses.length) throw new Error("target DNS resolution returned no addresses");
  if (!allowPrivateForTesting && addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("target must resolve only to public addresses");
  }

  return Object.freeze({
    startUrl: url.href,
    origin: url.origin,
    hostname: url.hostname,
    allowPrivateForTesting,
  });
}

export function normalizeDiscoveredLinks(baseUrl, hrefs, { maxLinks = 50 } = {}) {
  const base = new URL(baseUrl);
  const safe = [];
  const risky = [];
  const seen = new Set();
  for (const href of hrefs ?? []) {
    if (typeof href !== "string" || !href.trim()) continue;
    let url;
    try { url = new URL(href, base); } catch { continue; }
    if (!/^https?:$/u.test(url.protocol) || url.origin !== base.origin) continue;
    url.hash = "";
    const normalized = url.href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (RISKY_NAVIGATION.test(`${url.pathname} ${url.search}`)) {
      risky.push(normalized);
      continue;
    }
    safe.push(normalized);
    if (safe.length >= maxLinks) break;
  }
  return { safe, risky };
}

export async function authorizePublicRequest(urlValue, policy, { lookup = dns.lookup, mainFrame = false } = {}) {
  const url = new URL(urlValue);
  if (!/^https?:$/u.test(url.protocol)) return true;
  const testHttp = policy.allowPrivateForTesting && url.protocol === "http:" && url.hostname === policy.hostname;
  if (url.protocol !== "https:" && !testHttp) return false;
  if (url.username || url.password) return false;
  if (mainFrame && url.origin !== policy.origin) return false;
  const addresses = await resolveHost(url.hostname, lookup);
  if (!policy.allowPrivateForTesting && addresses.some(({ address }) => !isPublicAddress(address))) return false;
  if (policy.allowPrivateForTesting && url.hostname !== policy.hostname && addresses.some(({ address }) => !isPublicAddress(address))) return false;
  return true;
}

export async function installPublicAuthorization(context, policy, { lookup = dns.lookup } = {}) {
  await context.route(/https?:\/\//u, async (route) => {
    const request = route.request();
    let mainFrame = false;
    if (request.isNavigationRequest()) {
      try {
        const frame = request.frame();
        mainFrame = frame === frame.page().mainFrame();
      } catch {
        mainFrame = false;
      }
    }
    try {
      if (await authorizePublicRequest(request.url(), policy, { lookup, mainFrame })) await route.continue();
      else await route.abort("blockedbyclient");
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

export async function exploreSite(target, {
  maxPages = 6,
  maxLinksPerPage = 30,
  browserChannel = defaultBrowserChannel(),
  lookup = dns.lookup,
  allowPrivateForTesting = false,
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error("maxPages must be 1..20");
  const policy = await authorizePublicSite(target, { lookup, allowPrivateForTesting });
  const browser = await chromium.launch(chromiumLaunchOptions({ browserChannel }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = [];
  const queue = [policy.startUrl];
  const queued = new Set(queue);

  try {
    await installPublicAuthorization(context, policy, { lookup });

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift();
      const page = await context.newPage();
      const consoleErrors = [];
      const badResponses = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !/^Failed to load resource:/iu.test(message.text())) consoleErrors.push(message.text());
      });
      page.on("response", (response) => {
        if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status(), type: response.request().resourceType() });
      });

      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(100);
        const snapshot = await page.evaluate(() => ({
          title: document.title,
          hrefs: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
          forms: [...document.querySelectorAll("form")].map((form) => ({
            action: form.getAttribute("action") ?? "",
            method: (form.getAttribute("method") ?? "get").toLowerCase(),
            inputCount: form.querySelectorAll("input,textarea,select").length,
          })),
          buttons: [...document.querySelectorAll('button,input[type="submit"]')].slice(0, 30).map((button) => ({
            text: (button.innerText || button.value || button.getAttribute("aria-label") || "").trim().slice(0, 160),
            type: button.getAttribute("type") ?? (button.tagName === "BUTTON" ? "submit" : ""),
            disabled: Boolean(button.disabled),
          })),
        }));
        const links = normalizeDiscoveredLinks(url, snapshot.hrefs, { maxLinks: maxLinksPerPage });
        for (const link of links.safe) {
          if (!queued.has(link) && queued.size < maxPages * maxLinksPerPage) {
            queued.add(link);
            queue.push(link);
          }
        }
        pages.push({
          url: page.url(),
          status: response?.status() ?? null,
          title: snapshot.title,
          links: links.safe,
          skippedRiskyLinks: links.risky,
          forms: snapshot.forms,
          buttons: snapshot.buttons,
          consoleErrors,
          badResponses,
        });
      } catch (error) {
        pages.push({ url, status: null, title: "", links: [], skippedRiskyLinks: [], forms: [], buttons: [], consoleErrors, badResponses, error: error.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return {
    target: policy.startUrl,
    origin: policy.origin,
    pageCount: pages.length,
    pages,
    coverage: {
      discoveredSafeLinks: pages.reduce((sum, page) => sum + page.links.length, 0),
      skippedRiskyLinks: pages.reduce((sum, page) => sum + page.skippedRiskyLinks.length, 0),
      formsObserved: pages.reduce((sum, page) => sum + page.forms.length, 0),
      buttonsObserved: pages.reduce((sum, page) => sum + page.buttons.length, 0),
    },
  };
}
