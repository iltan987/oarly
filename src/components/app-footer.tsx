import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { env } from '@/env';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

/**
 * The entry/auth/legal footer.
 *
 * Same `max-w-[90rem] px-4 sm:px-6` container as `AppShell`'s header, so the two line up
 * at both outer edges on every viewport.
 *
 * `mt-auto` is belt-and-braces: `AppShell`'s `<main>` is already `flex-1` inside a
 * `min-h-dvh flex-col` root, so the footer is pinned to the bottom on short pages by that
 * alone. Nothing observable — in jsdom or in a browser — changes if it is removed, which
 * is recorded here rather than guarded by a test that could not fail honestly.
 *
 * `/request-club` had ZERO inbound links from any page before this, and `/privacy` was
 * reachable only from the sign-up consent line. Both are apex-only routes, so on a tenant
 * host they must be absolute `<a href>`: a `<Link href="/privacy">` on a club subdomain
 * stays on the tenant host and 404s (the same hazard documented at
 * `app/s/[slug]/manage/layout.tsx`).
 */
export async function AppFooter({ tenant }: { tenant?: boolean }) {
  const t = await getTranslations('common');
  const origin = parseAppOrigin(env.APP_URL);

  const links = [
    { path: '/privacy', label: t('privacy') },
    { path: '/request-club', label: t('requestClub') },
  ];

  // A STRING, not a number: `{year}` with a numeric value goes through Intl.NumberFormat,
  // and Turkish groups thousands with a dot — the footer would read "© 2.026 Oarly".
  const year = String(new Date().getFullYear());

  return (
    <footer className="mt-auto w-full">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <span>{t('copyright', { year })}</span>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {links.map(({ path, label }) =>
            tenant ? (
              <a key={path} href={apexUrl(path, origin)} className="hover:text-foreground hover:underline">
                {label}
              </a>
            ) : (
              <Link key={path} href={path} className="hover:text-foreground hover:underline">
                {label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
