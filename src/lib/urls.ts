export type AppOrigin = { protocol: string; rootDomain: string };

/** Parse APP_URL (the apex origin) into protocol + host[:port]. */
export function parseAppOrigin(appUrl: string): AppOrigin {
  const u = new URL(appUrl);
  return { protocol: u.protocol, rootDomain: u.host };
}

/** Canonical subdomain URL for a club, e.g. https://demo.oarly.sbs */
export function clubUrl(slug: string, origin: AppOrigin): string {
  return `${origin.protocol}//${slug}.${origin.rootDomain}`;
}

/** Apex URL for a path (path must begin with '/'), e.g. https://oarly.sbs/privacy */
export function apexUrl(path: string, origin: AppOrigin): string {
  return `${origin.protocol}//${origin.rootDomain}${path}`;
}

/**
 * Validate a post-auth redirect target against our own domain to prevent open redirects.
 * Accepts app-relative paths (starting with a single '/') and absolute URLs whose host is
 * the apex root or any subdomain of it. Anything else returns `fallback`.
 */
export function safeRedirect(
  target: string | null | undefined,
  origin: AppOrigin,
  fallback = '/',
): string {
  if (!target) return fallback;
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return fallback;
  }
  const root = origin.rootDomain.split(':')[0].toLowerCase();
  const host = url.host.split(':')[0].toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return target;
  return fallback;
}
