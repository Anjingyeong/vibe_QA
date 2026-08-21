import dns from "node:dns/promises";
import net from "node:net";

export const DEFAULT_TARGET = "https://songsong.jingyeong.cloud";

function ipv4Number(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((result, part) => result * 256 + part, 0) >>> 0;
}

function inV4(value, base, bits) {
  const address = ipv4Number(value);
  const network = ipv4Number(base);
  if (address === null || network === null) return false;
  const divisor = 2 ** (32 - bits);
  return Math.floor(address / divisor) === Math.floor(network / divisor);
}

export function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    return ![["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]].some(([base, bits]) => inV4(address, base, bits));
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
    return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || /^fe[89ab]/u.test(normalized) || normalized.startsWith("2001:db8:"));
  }
  return false;
}

async function resolveHost(hostname, lookup) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (net.isIP(hostname)) return [{ address: hostname }];
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`target DNS resolution failed: ${error.code ?? "unknown"}`);
  }
}

function parseAndCheck(value, { allowHosts, allowPrivateForTesting = false }) {
  let url;
  try { url = new URL(value ?? DEFAULT_TARGET); } catch { throw new Error("target must be a valid URL"); }
  const testingHttp = allowPrivateForTesting && url.protocol === "http:";
  if (url.protocol !== "https:" && !testingHttp) throw new Error("target must use HTTPS");
  if (url.username || url.password) throw new Error("target URL credentials are forbidden");
  if (!allowPrivateForTesting && url.port) throw new Error("target must use the default HTTPS port");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("target must have no base path, query, or fragment");
  const hosts = allowHosts ?? [new URL(DEFAULT_TARGET).hostname];
  if (!hosts.includes(url.hostname)) throw new Error("target host is not in the explicit allowlist");
  return url;
}

export async function authorizeTarget(value, options = {}) {
  const lookup = options.lookup ?? dns.lookup;
  const url = parseAndCheck(value, options);
  const addresses = await resolveHost(url.hostname, lookup);
  if (!addresses.length || (!options.allowPrivateForTesting && addresses.some(({ address }) => !isPublicAddress(address)))) {
    throw new Error("target must resolve only to public addresses");
  }
  return Object.freeze({ origin: url.origin, hostname: url.hostname, protocol: url.protocol,
    port: url.port, allowPrivateForTesting: Boolean(options.allowPrivateForTesting), addresses: addresses.map((x) => x.address) });
}

export async function authorizeRequest(value, policy,
  { lookup = dns.lookup, mainFrameNavigation = false } = {}) {
  const url = new URL(value);
  if (!/^https?:$/u.test(url.protocol)) return url;
  const testingHttp = policy.allowPrivateForTesting && url.protocol === "http:" &&
    url.hostname === policy.hostname;
  if ((url.protocol !== "https:" && !testingHttp) || url.username || url.password ||
      (!policy.allowPrivateForTesting && url.port)) {
    throw new Error("request destination is outside the authorized target");
  }
  if (mainFrameNavigation && url.origin !== policy.origin) {
    throw new Error("main-frame navigation left the authorized target");
  }
  const addresses = await resolveHost(url.hostname, lookup);
  if (!policy.allowPrivateForTesting && addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("request resolved to a non-public address");
  }
  return url;
}

export async function installAuthorization(context, policy, options = {}) {
  await context.route(/https?:\/\//u, async (route) => {
    const request = route.request();
    let mainFrameNavigation = false;
    if (request.isNavigationRequest()) {
      try {
        const frame = request.frame();
        mainFrameNavigation = frame === frame.page().mainFrame();
      } catch {
        mainFrameNavigation = false;
      }
    }
    try {
      await authorizeRequest(request.url(), policy, { ...options, mainFrameNavigation });
      await route.continue();
    }
    catch { await route.abort("blockedbyclient"); }
  });
}
