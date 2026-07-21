export function allowedChromeRedirect(value: string, configuredIds: string): boolean {
  const ids = new Set(configuredIds.split(",").map((id) => id.trim().toLowerCase()).filter((id) => /^[a-p]{32}$/.test(id)));
  if (!ids.size) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  const match = url.hostname.toLowerCase().match(/^([a-p]{32})\.chromiumapp\.org$/);
  if (!match || !ids.has(match[1])) return false;
  return url.pathname === "/" || /^\/[A-Za-z0-9._~/-]{1,128}$/.test(url.pathname);
}
