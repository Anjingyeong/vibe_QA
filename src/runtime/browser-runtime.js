export function defaultBrowserChannel(platform = process.platform) {
  if (platform === "win32") return "msedge";
  if (platform === "linux") return "chromium";
  return null;
}

export function chromiumLaunchOptions({ browserChannel = defaultBrowserChannel(), headless = true } = {}) {
  return browserChannel ? { channel: browserChannel, headless } : { headless };
}
