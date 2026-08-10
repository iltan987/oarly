import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The restriction card's text must clear WCAG AA on its own background, in both themes.
 *
 * This exists because the first version of the card did not, and nothing could tell me.
 * It put the title AND the lead — the sentence carrying the date and the time, in the
 * most common restriction state, on three surfaces — in `--warn` on `--warn-bg`, which is
 * **4.39:1** in the light theme. That pairing is inherited from `StatusPill`'s warn tone,
 * where it is fine: a two-word pill is a label, and the eye has a shape to fall back on.
 * A paragraph has neither.
 *
 * 4.39 is not "large text" either. WCAG's 3:1 allowance needs >=18.66px bold (or 24px
 * regular); the lead is 14px `font-medium`. So the floor here is 4.5 for every pairing.
 *
 * ## Why this is testable at all
 *
 * The tones are LITERAL HEX in `globals.css` (see the comment on `--warn-ink`), so the
 * whole check is arithmetic over the file with no colour library and no browser. The rest
 * of the palette is `oklch()`/`color-mix()` and is deliberately out of scope — converting
 * those needs a real colour pipeline, and a half-right conversion producing confident
 * wrong numbers is worse than not checking. The hex tokens happen to be exactly the
 * semantic tones, which are exactly what the notice paints with.
 *
 * The numbers below were measured independently in Chrome first (canvas-composited sRGB,
 * with black-on-white sanity-checked at 21:1). This test reproduces them from source; the
 * `it('reproduces the known failure')` case is what proves the arithmetic is right rather
 * than merely self-consistent.
 */

const CSS = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/** The `:root { … }` and `.dark { … }` bodies, non-greedily. */
function block(selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS);
  if (!match) throw new Error(`no ${selector} block in globals.css`);
  return match[1];
}

/** `--name: #rrggbb;` only. Returns null for a token defined as oklch/color-mix. */
function hexToken(body: string, name: string): string | null {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(body);
  return match ? match[1].toLowerCase() : null;
}

function srgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = srgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
}

const THEMES = [
  { name: 'light', body: block(':root') },
  { name: 'dark', body: block('\\.dark') },
] as const;

/** The AA floor for text below 18.66px bold. Everything the notice renders is below it. */
const AA = 4.5;

describe('contrast maths', () => {
  // Pinned against hand-checkable extremes, because every assertion below is only as
  // good as this function and a plausible-looking wrong one would pass all of them.
  it('agrees with the known extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5); // the classic AA-boundary grey
  });

  /**
   * THE calibration case, and the reason this file can be trusted: the pairing this task
   * shipped and had to fix. If this stops reading 4.39, the arithmetic drifted — not the
   * palette, which no longer uses this pairing for prose at all.
   */
  it('reproduces the known failure that prompted this file', () => {
    expect(contrast('#b45309', '#fbeedc')).toBe(4.39);
    expect(4.39).toBeLessThan(AA);
  });
});

describe('the restriction card clears AA in both themes', () => {
  it.each(THEMES)('$name defines every tone the card paints with, as hex', ({ body }) => {
    // Asserted first: a token renamed or switched to color-mix would make `hexToken`
    // return null, and a `null` skipped by a filter is a test that stops testing.
    for (const token of ['warn', 'warn-bg', 'warn-ink', 'bad', 'bad-bg', 'bad-ink']) {
      expect(hexToken(body, token), `--${token}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /** Title and lead on the card: `text-warn-ink` / `text-bad-ink` over the tint. */
  it.each(THEMES)('$name puts the card ink above 4.5:1 on its own tint', ({ name, body }) => {
    const warn = contrast(hexToken(body, 'warn-ink')!, hexToken(body, 'warn-bg')!);
    const bad = contrast(hexToken(body, 'bad-ink')!, hexToken(body, 'bad-bg')!);
    expect(warn, `${name}: --warn-ink on --warn-bg`).toBeGreaterThanOrEqual(AA);
    expect(bad, `${name}: --bad-ink on --bad-bg`).toBeGreaterThanOrEqual(AA);
  });

  /**
   * The regression this file was written for, stated as a property rather than a number:
   * the ink must stay strictly better than the tone it replaced. Someone "simplifying"
   * `--warn-ink` back to `--warn` fails here as well as above, and this one says why.
   */
  it.each(THEMES)('$name keeps the ink better than the pill tone it replaced', ({ name, body }) => {
    for (const tone of ['warn', 'bad'] as const) {
      const ink = contrast(hexToken(body, `${tone}-ink`)!, hexToken(body, `${tone}-bg`)!);
      const flat = contrast(hexToken(body, tone)!, hexToken(body, `${tone}-bg`)!);
      expect(ink, `${name}: --${tone}-ink vs --${tone} on --${tone}-bg`).toBeGreaterThan(flat);
    }
  });
});
