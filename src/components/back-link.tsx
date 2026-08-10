import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * One link back to where the reader came from — **not** a breadcrumb, and the difference
 * is a claim about the product, not a styling choice.
 *
 * A breadcrumb asserts a URL hierarchy. There isn't one: `/manage/profile` is deliberately
 * NOT under `/manage/settings` — that is the whole reason the nav could shrink to four
 * items without a single URL changing, so nothing that links to the setup pages rots.
 * Rendering `Manage / Settings / Profile` above the URL `/manage/profile` would put a lie
 * in the chrome, and the first person to trust it would build a route to match.
 *
 * `/manage/schedule/preview` is the one place where the parent IS the parent, so its back
 * link points at `/manage/schedule` and says so. Same component, honest either way,
 * because it only ever claims "here is one place to go", never "here is where you are".
 */
export function BackLink({ href, label }: { href: string; label: string }): ReactElement {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {label}
    </Link>
  );
}
