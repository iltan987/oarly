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
