// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GlobalError from './global-error';

/**
 * Next hands an error boundary BOTH recovery functions
 * (`next/dist/client/components/error-boundary.js:113-114`); the component only declares
 * the one it uses. Rendering through this alias is what lets the test below pass both and
 * prove the click reaches `retry` and never `reset` — the component's own prop type would
 * reject the unused one as an excess property.
 */
const Boundary = GlobalError as React.ComponentType<{
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
}>;

/**
 * There is deliberately NO `vi.mock('next-intl')` in this file, and no provider around
 * the render below. That absence is the test.
 *
 * `global-error.tsx` replaces the root layout, which is where `NextIntlClientProvider`
 * lives — so by the time it mounts, the provider is gone. A `useTranslations` call here
 * throws, the boundary that was meant to catch the failure becomes a second failure, and
 * the user gets Next's unstyled default. Rendering it bare is what makes that a test
 * failure instead of a production incident: add `useTranslations` to the component and
 * these tests throw at render.
 *
 * Every other component test in this repo mocks `next-intl`, so copying one of those
 * files as a template would silently destroy this property. Hence the size of this
 * comment relative to the assertions.
 */
describe('the global error boundary', () => {
  const error = Object.assign(new Error('root layout exploded'), { digest: 'deadbeef' });

  it('renders with no intl provider mounted', () => {
    render(<Boundary error={error} reset={() => {}} retry={() => {}} />);
    // Both languages, because the locale resolver is among the things that may have
    // failed. Turkish leads: it is this app's default locale.
    expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tekrar dene/ })).toBeInTheDocument();
  });

  /**
   * `retry`, never `reset` — see `route-error.tsx`. `reset` only clears the boundary's own
   * state and re-renders the same failed server payload; `retry` refreshes first. It
   * matters most on this page: the root layout is what failed, and this is the only
   * control the user has.
   */
  it('wires its button to retry and not to reset', () => {
    const reset = vi.fn();
    const retry = vi.fn();
    render(<Boundary error={error} reset={reset} retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  /**
   * It replaces the root layout, so it owns the document — `<html lang>` included. On a
   * page whose only job is to be readable when everything else failed, a missing `lang`
   * is what makes a Turkish sentence get read out in English by a screen reader.
   *
   * Asserted against `document.documentElement`, NOT against RTL's container: React 19
   * HOISTS `<html>` and `<body>` out of the rendered tree and applies their attributes to
   * the real document, so `container.querySelector('html')` is null here even though the
   * component plainly renders one. That null is what a first version of this test
   * asserted `not.toBeNull()` on, and it failed — which is the only reason this is
   * written down rather than assumed.
   *
   * The attribute is cleared first so the assertion measures this render and not jsdom's
   * document carrying over from the tests above.
   */
  it('supplies its own html lang and body', () => {
    document.documentElement.removeAttribute('lang');
    expect(document.documentElement.getAttribute('lang')).toBeNull();

    render(<Boundary error={error} reset={() => {}} retry={() => {}} />);

    expect(document.documentElement.getAttribute('lang')).toBe('tr');
    // The body it renders, distinguishable from jsdom's own empty one by the styles it
    // carries: without a `<body>` of its own this page is blank in a browser.
    expect(document.body.getAttribute('style')).toContain('min-height: 100dvh');
  });

  it('shows the user neither the error message nor its digest', () => {
    const { container } = render(<Boundary error={error} reset={() => {}} retry={() => {}} />);
    expect(container.textContent).not.toContain('root layout exploded');
    expect(container.textContent).not.toContain('deadbeef');
  });
});
