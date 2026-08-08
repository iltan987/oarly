import Link from 'next/link';

/**
 * Prev / next links for the offset-paginated admin lists (users, clubs). Renders
 * nothing when everything fits on one page. Links, not buttons: pagination is
 * navigation, and the page number belongs in the URL so a result set can be shared.
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
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
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
      {page > 1 ? <Link href={href(page - 1)} className="text-brand hover:underline">{prevLabel}</Link> : <span />}
      <span className="text-muted-foreground">{rangeLabel}</span>
      {page < pages ? <Link href={href(page + 1)} className="text-brand hover:underline">{nextLabel}</Link> : <span />}
    </nav>
  );
}
