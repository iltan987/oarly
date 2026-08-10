import Link from 'next/link';

import { normalizePage, pageCount } from '@/lib/pagination';

/**
 * Prev / next links for the offset-paginated console lists — `/admin` (clubs),
 * `/admin/users`, and now the owner's own `/manage/members` roster. Renders nothing when
 * everything fits on one page. Links, not buttons: pagination is navigation, and the page
 * number belongs in the URL so a result set can be shared.
 *
 * `basePath` is whatever the CALLER's public URL is, and on a tenant that is
 * `/manage/members` rather than the internal `/s/{slug}/manage/members` — the slug lives
 * in the hostname, and the internal form would double-prefix through the proxy rewrite.
 * The name stays `Admin*` for now: renaming a component shared by three pages inside a
 * task that also rewrites one of them multiplies what a reviewer has to re-verify.
 *
 * `page` is clamped against the page count rather than trusted: a caller that passes
 * the page from the URL unmodified would otherwise render a Previous link to
 * `?page=998` of a four-page list, which is another empty page with another Previous
 * link behind it.
 */
export function AdminPagination({ basePath, query, page, pageSize, total, prevLabel, nextLabel, rangeLabel }: {
  basePath: string;
  query: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
  prevLabel: string;
  nextLabel: string;
  rangeLabel: string;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  const current = Math.min(normalizePage(page), pages);
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    // Page 1 is the bare URL: `?page=1` and no `page` are the same list, and two URLs
    // for one page is how a shared link and a bookmark stop matching.
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className="mt-4 flex items-center justify-between text-sm">
      {current > 1 ? <Link href={href(current - 1)} className="text-brand hover:underline">{prevLabel}</Link> : <span />}
      <span className="text-muted-foreground">{rangeLabel}</span>
      {current < pages ? <Link href={href(current + 1)} className="text-brand hover:underline">{nextLabel}</Link> : <span />}
    </nav>
  );
}
