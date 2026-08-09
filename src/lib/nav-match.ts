/**
 * Which tab of a nav bar owns the current pathname, generalising the special-casing
 * that used to live by hand in `app/admin/_nav.tsx`.
 *
 * `owns` names route subtrees an item is responsible for that do not sit under its own
 * href by any useful prefix rule — e.g. the admin clubs tab is `/admin` (the list), but
 * the detail page every row links to lives at `/admin/clubs/[id]`.
 *
 * `exact` is for items whose href would otherwise claim every route beneath it as a
 * prefix — e.g. `/admin` is a prefix of every route in that console, and an empty-href
 * "overview" item is a prefix of everything under its own section.
 *
 * Longest match wins: a pathname can satisfy more than one item's prefix (an `owns`
 * entry and a longer sibling href both matching), and the more specific one should
 * light up. This is also what makes the descendant boundary matter — a prefix match
 * requires `pathname === prefix || pathname.startsWith(prefix + '/')`, not a bare
 * `startsWith(prefix)`, so `/adminfoo` does not match `/admin`.
 */
export type NavItem = { href: string; exact?: boolean; owns?: readonly string[] };

function prefixMatchLength(pathname: string, prefix: string): number {
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix.length : -1;
}

function itemMatchLength(pathname: string, item: NavItem): number {
  const hrefScore = item.exact
    ? pathname === item.href
      ? item.href.length
      : -1
    : prefixMatchLength(pathname, item.href);
  const ownsScores = (item.owns ?? []).map((prefix) => prefixMatchLength(pathname, prefix));
  return Math.max(hrefScore, ...ownsScores);
}

/** Index of the item that owns `pathname`, or -1 if none does. Longest prefix wins. */
export function activeNavIndex(pathname: string, items: readonly NavItem[]): number {
  const scores = items.map((item) => itemMatchLength(pathname, item));
  const best = Math.max(-1, ...scores);
  return best < 0 ? -1 : scores.indexOf(best);
}
