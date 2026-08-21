import { mkdir } from "node:fs/promises";
import path from "node:path";

export const CREDENTIAL_SELECTORS = [
  "[data-room-code]", "[data-player-token]", "[data-credential]", "#room-code",
  'input[name*="code" i]', 'input[name*="token" i]', '[class*="room-code" i]',
];

export async function captureScreenshot(page, artifactRoot, relativePath, extraMasks = [],
  secretValues = []) {
  const root = path.resolve(artifactRoot);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("screenshot path must remain beneath the artifact root");
  }
  await mkdir(path.dirname(absolute), { recursive: true });
  await page.evaluate((values) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (values.some((value) => node.nodeValue?.includes(value))) {
        node.parentElement?.setAttribute("data-vibecheck-secret-mask", "");
      }
    }
  }, secretValues);
  const masks = [
    ...CREDENTIAL_SELECTORS.map((selector) => page.locator(selector)),
    page.locator("[data-vibecheck-secret-mask]"),
    ...extraMasks,
  ];
  try {
    await page.screenshot({ path: absolute, fullPage: true, mask: masks, maskColor: "#000000" });
  } finally {
    await page.locator("[data-vibecheck-secret-mask]").evaluateAll((elements) =>
      elements.forEach((element) => element.removeAttribute("data-vibecheck-secret-mask")));
  }
  return relative.split(path.sep).join("/");
}
