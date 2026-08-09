import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { env } from '@/env';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

export type FooterLabels = {
  copyright: string;
  privacy: string;
  requestClub: string;
};

/**
 * The footer's copy, resolved by the caller.
 *
 * This is async and `AppFooter` is NOT, for the reason spelled out in `app-brand.tsx`: the
 * footer is mounted as a *prop* of `AppShell`, and an async component anywhere in the tree
 * `render(await Layout({...}))` returns makes @testing-library render an empty div with no
 * error at all. Awaiting the copy at the call site keeps the tree synchronous, so a test
 * that renders any footer-bearing surface sees real DOM.
 *
 * The year lives here rather than in the component so the string conversion below has one
 * home, and so `AppFooter` stays a pure function of its props.
 */
export async function footerLabels(): Promise<FooterLabels> {
  const t = await getTranslations('common');
  // A STRING, not a number: `{year}` with a numeric value goes through Intl.NumberFormat,
  // and Turkish groups thousands with a dot — the footer would read "© 2.026 Oarly".
  const year = String(new Date().getFullYear());
  return {
    copyright: t('copyright', { year }),
    privacy: t('privacy'),
    requestClub: t('requestClub'),
  };
}

/**
 * The entry/auth/legal footer.
 *
 * Same `max-w-[90rem] px-4 sm:px-6` container as `AppShell`'s header, so the two line up
 * at both outer edges on every viewport. That is a requirement, not a coincidence, and
 * `app-footer.test.tsx` pins the classes it rests on.
 *
 * `mt-auto` is belt-and-braces: `AppShell`'s `<main>` is already `flex-1` inside a
 * `min-h-dvh flex-col` root, so the footer is pinned to the bottom on short pages by that
 * alone. Nothing observable — in jsdom or in a browser — changes if it is removed
 * (measured: `margin-top` computes to `0px` on every page, and the footer sits at the same
 * y with and without it), which is recorded here rather than guarded by a test that could
 * not fail honestly.
 *
 * `/request-club` had ZERO inbound links from any page before this, and `/privacy` was
 * reachable only from the sign-up consent line. Both are apex-only routes, so on a tenant
 * host they must be absolute `<a href>`: a `<Link href="/privacy">` on a club subdomain
 * stays on the tenant host and 404s (the same hazard documented at
 * `app/s/[slug]/manage/layout.tsx`).
 */
export function AppFooter({ tenant, labels }: { tenant?: boolean; labels: FooterLabels }) {
  const origin = parseAppOrigin(env.APP_URL);

  const links = [
    { path: '/privacy', label: labels.privacy },
    { path: '/request-club', label: labels.requestClub },
  ];

  return (
    <footer className="mt-auto w-full">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <span>{labels.copyright}</span>
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
