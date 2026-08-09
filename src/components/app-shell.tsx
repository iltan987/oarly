import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The Tailwind suffix, not an invented vocabulary, so a reviewer can diff `width="md"`
 * against the `max-w-md` this replaced by eye.
 */
export type ShellWidth = 'sm' | 'md' | '2xl' | '3xl' | '4xl';

/**
 * A static literal record, NOT `` `max-w-${width}` ``. Tailwind's scanner reads source
 * text, so a template literal produces no CSS at all and every content column would
 * silently render full-bleed.
 */
const WIDTH: Record<ShellWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
};

/**
 * The header's own container width. Deliberately a module constant and not a function of
 * the `width` prop: that coupling IS the reported defect ("when I press the manage club
 * button ... at least I expect theme button, language switch to remain in the same
 * place"). Eleven files each hand-rolled their own shell, with `max-w-sm`/`md`/`2xl`/
 * `3xl`/`4xl` and `p-4`/`p-6`/`p-8`, so both the header's right edge and its gutter moved
 * on every navigation between sections.
 *
 * 90rem = 1440px, chosen because it is >= the widest content column in the product. A
 * narrower header would end up narrower than its own content on the widest surface, which
 * is how the controls would start moving again.
 *
 * The gutter (`px-4 sm:px-6`) matters more than the max-width: below ~480px every
 * `max-w-*` above is inert, so on a phone the ONLY thing that moved the controls was 16
 * vs 24 vs 32px of padding. Unifying max-widths alone would have left the phone broken.
 */
const HEADER_CONTAINER = 'mx-auto flex h-14 w-full max-w-[90rem] items-center justify-between gap-3 px-4 sm:px-6';

/**
 * One page chrome for every surface: a full-bleed header whose inner container is always
 * `max-w-[90rem] px-4 sm:px-6`, with the per-section content column underneath.
 *
 * `h-14` is load-bearing beyond looks — it pins the trigger's **y**. Before this, the
 * manage layout put a `text-2xl` `<h1>` in the same row as the controls while the privacy
 * page put nothing there, so the avatar's vertical position moved too, not just its x.
 *
 * ## Why `brand` is unconditionally `min-w-0` and `menu` unconditionally `shrink-0`
 *
 * The deleted `src/components/app-controls.tsx` carried a *conditional* root class
 * (`min-w-0` with a leading slot, `shrink-0` without) and its doc comment recorded that
 * the conditional was arrived at by rendering in a real browser after two
 * confidently-reasoned attempts were both wrong: a flat `min-w-0` squeezed the control
 * cluster below its own content width on surfaces with no leading slot, and a flat
 * `shrink-0` reproduced the manage-layout overflow, because a nested flex container's
 * automatic min-width caps a `max-width`-limited child's contribution at that max-width
 * (160px there) rather than at 0.
 *
 * Both failures needed the leading slot to be nested INSIDE the control cluster, so the
 * cluster's own automatic min-width capped how far the slot could compress. Here `brand`
 * and `menu` are siblings of a `justify-between` row — the arrangement the old shape could
 * not reach — so neither one's min-width is mediated by the other's, and the invariant
 * flattens: the brand absorbs 100% of the squeeze, the menu never shrinks. Verified by
 * rendering, not by reasoning; see this task's report for the measured trigger positions.
 */
export function AppShell({
  width,
  brand,
  menu,
  footer,
  align = 'top',
  children,
}: {
  /** Content column only. The header is NEVER this width. */
  width: ShellWidth;
  /** Header left slot: wordmark on apex, club logo + name on a tenant. */
  brand: ReactNode;
  /** Rendered by the caller, so the caller owns host-correct hrefs. */
  menu: ReactNode;
  footer?: ReactNode;
  align?: 'top' | 'center';
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="w-full">
        <div className={HEADER_CONTAINER}>
          <div className="flex min-w-0 items-center gap-2">{brand}</div>
          <div className="flex shrink-0 items-center">{menu}</div>
        </div>
      </header>
      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-6 px-4 pb-10 sm:px-6',
          WIDTH[width],
          align === 'center' && 'justify-center',
        )}
      >
        {children}
      </main>
      {footer}
    </div>
  );
}
