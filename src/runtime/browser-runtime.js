export function defaultBrowserChannel(platform = process.platform) {
  return platform === "win32" ? "msedge" : null;
}

export function chromiumLaunchOptions({ browserChannel = defaultBrowserChannel(), headless = true } = {}) {
  return browserChannel ? { channel: browserChannel, headless } : { headless };
}
