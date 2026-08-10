import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `data-horizontal:` / `data-vertical:` are the two Tailwind variants the shadcn
 * base-nova primitives use that do NOT work out of the box, and the failure is silent.
 *
 * Tailwind v4's built-in `data-*` variant compiles to a bare attribute selector, so
 * `data-horizontal:h-px` looks for `[data-horizontal]`. Base UI never writes that
 * attribute — it writes `data-orientation="horizontal"`. The rule therefore matched
 * nothing, and every `<Separator />` in the product computed `height: 0px`: present in
 * the accessibility tree as `role="separator"`, invisible on screen. Nothing throws,
 * nothing warns, and no component test can see it, because jsdom does not resolve
 * variants at all.
 *
 * So this file asserts the two halves against each other, off disk:
 *
 * 1. `app/globals.css` defines both variants, keyed to `[data-orientation=...]`.
 * 2. The generated primitives still spell them `data-horizontal:` / `data-vertical:`.
 *
 * Either half alone is worthless. A variant nobody uses is dead CSS; a class with no
 * variant behind it is the bug that was here. Reading the CLI-generated file rather than
 * naming its classes by hand also means a future `shadcn add --overwrite` that changes the
 * convention fails HERE, pointing at the mismatch, instead of quietly blanking a rule.
 *
 * The computed value is in this task's report: `1px` after, `0px` before.
 */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const css = read('../../app/globals.css');

describe('the orientation variants the shadcn primitives depend on', () => {
  it.each(['horizontal', 'vertical'])('maps data-%s onto Base UI\'s data-orientation', (orientation) => {
    const variant = new RegExp(
      `@custom-variant\\s+data-${orientation}\\s*\\{[^}]*\\[data-orientation="${orientation}"\\]`,
    );
    expect(css).toMatch(variant);
  });

  it('is still what the generated separator asks for', () => {
    const separator = read('./ui/separator.tsx');
    // The geometry classes, not just the variant prefix: these are the ones whose absence
    // is a zero-height element rather than a colour nobody notices.
    expect(separator).toContain('data-horizontal:h-px');
    expect(separator).toContain('data-horizontal:w-full');
    expect(separator).toContain('data-vertical:w-px');
  });

  /**
   * The other primitives that were dead for the same reason, so that removing the variants
   * fails on more than one file and a reader can see the blast radius from here.
   */
  it('is still what the other generated primitives ask for', () => {
    expect(read('./ui/toggle-group.tsx')).toContain('data-vertical:');
    expect(read('./ui/field.tsx')).toContain('group-has-data-horizontal/field:');
  });
});
