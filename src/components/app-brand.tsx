import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/initials';

/**
 * The two shapes of `AppShell`'s `brand` slot, in one place so the ten surfaces that
 * render one of them cannot drift apart again.
 *
 * Neither is a link by default. `AppShell` already places them in a `min-w-0` flex item;
 * the inner `min-w-0` here is what lets the club name's `truncate` engage, since a flex
 * item's automatic minimum size would otherwise floor it at its content width.
 *
 * Both are SYNCHRONOUS, and `AppWordmark` therefore takes the already-translated name
 * rather than calling `getTranslations` itself. These render as a prop of `AppShell`, and
 * this repo's server-component tests render `await Layout({...})` through
 * `@testing-library/react` — a client renderer, which cannot resolve an async component
 * nested anywhere in the returned tree. An async wordmark makes the whole layout render
 * as an empty div, with no error to explain it (this is not hypothetical: it is how the
 * first version of this file failed `app/admin/layout.test.tsx`).
 */

/** Apex surfaces: the product wordmark. Pass `t('appName')`. */
export function AppWordmark({ name }: { name: string }) {
  return <span className="truncate font-heading text-xl font-bold text-brand">{name}</span>;
}

/** Tenant surfaces: the club's logo and name. */
export function ClubBrand({
  name,
  logoUrl,
  href,
}: {
  name: string;
  logoUrl?: string | null;
  /** Set on surfaces where the club home is somewhere else (the member area). */
  href?: string;
}) {
  const inner = (
    <>
      <Avatar className="size-8 shrink-0 rounded-field after:rounded-field">
        {logoUrl ? <AvatarImage src={logoUrl} alt="" className="rounded-field" /> : null}
        <AvatarFallback className="rounded-field bg-brand font-heading text-xs font-bold text-primary-foreground">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-heading text-lg font-semibold text-brand">{name}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex min-w-0 items-center gap-2">
      {inner}
    </Link>
  ) : (
    <div className="flex min-w-0 items-center gap-2">{inner}</div>
  );
}
