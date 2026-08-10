import { AppShell } from '@/components/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The fallback for EVERY tenant surface, and it is deliberately nothing but the header.
 *
 * ## It is not the club landing page's fallback — it is the whole tenant's
 *
 * `manage/` and `(member)/` have `loading.tsx` files of their own, but those sit BELOW
 * this one. On a cold load the segments render top-down, so this is what paints first on
 * `/manage/...` and `/book` too; theirs only take over once `app/s/[slug]/layout.tsx` has
 * resolved. Measured on a cold `/manage/members` with a 3s delay in the manage layout:
 * this fallback at 411ms, the console at 3197ms — against 3403ms of blank tab with no
 * fallback at all.
 *
 * ## Which is why it draws no content and no footer
 *
 * The first version of this file mirrored the landing page: a centred `max-w-md` card with
 * an avatar and two CTA bars, plus a footer. On the landing page that is a good silhouette.
 * On the other two tenant surfaces it was a lie that then visibly corrected itself — an
 * owner refreshing `/manage` got a narrow centred card that swapped to a full-width console
 * with a sidebar (`max-w-md` -> `max-w-[90rem]`), and a member got `md` -> `2xl`. The
 * footer was worse than a mismatch: neither `manage/layout.tsx` nor `(member)/layout.tsx`
 * passes one, so it drew a whole page region that never arrives.
 *
 * The header is the one thing that IS identical on all three. `AppShell` owns it, and both
 * `ConsoleShell` and `(member)/layout.tsx` pass `brand`/`menu` straight through to it — so
 * a header-only fallback is correct everywhere and jumps nowhere. The `width` prop below is
 * inert with no children; it cannot commit this file to a content column it does not know.
 *
 * That is the deliberate trade: less silhouette on the landing page, zero shape mismatch on
 * the other two. Going through `AppShell` rather than hand-rolling a header row is what
 * makes "correct everywhere" true by construction — the `h-14` row, the
 * `max-w-[90rem] px-4 sm:px-6` container and the brand/menu slots come from the same code
 * the real chrome uses. (An earlier hand-rolled footer here proved the point in the
 * negative: it missed `text-sm` and landed ~4px off the real one.)
 *
 * ## What it does and does not cover
 *
 * The club lookup in `app/s/[slug]/layout.tsx` is uncached runtime data in a layout, and
 * `loading.js` shows no fallback for a layout above it (`node_modules/next/dist/docs/
 * 01-app/03-api-reference/03-file-conventions/loading.md`) — without Cache Components the
 * response blocks until that layout resolves. What streams behind this is everything
 * BELOW: the landing page's `getCurrentUser`/`getMembership`/`getRestriction`, and the
 * nested layouts of `manage/` and `(member)/`.
 */
export default function Loading() {
  return (
    <AppShell
      width="md"
      brand={
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="size-8 shrink-0 rounded-field" />
          <Skeleton className="h-5 w-32 rounded" />
        </div>
      }
      menu={<Skeleton className="size-8 rounded-full" />}
    >
      {null}
    </AppShell>
  );
}
