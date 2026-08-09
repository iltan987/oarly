// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'tr',
}));
vi.mock('@/i18n/set-locale', () => ({ setLocale: vi.fn() }));
vi.mock('@/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

import { AppControls } from './app-controls';

describe('AppControls', () => {
  it('always offers language and theme', () => {
    render(<AppControls />);
    expect(screen.getByRole('group', { name: 'language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toggleTheme' })).toBeInTheDocument();
  });

  it('offers sign-out only when a sign-out target is given', () => {
    const { rerender } = render(<AppControls />);
    expect(screen.queryByRole('button', { name: 'signOut' })).not.toBeInTheDocument();
    rerender(<AppControls signOutUrl="https://example.test/sign-in" />);
    expect(screen.getByRole('button', { name: 'signOut' })).toBeInTheDocument();
  });

  it('renders the leading slot before the toggles', () => {
    // The manage layout puts the account link here; it must not land between the
    // language and theme controls, which are a visual pair.
    //
    // The toggles now live one level deeper, in their own non-shrinking wrapper (see
    // AppControls's doc comment), so the group's `.parentElement` is that inner wrapper,
    // not the root. Reach for the leading slot's own parent instead — that IS the root,
    // regardless of how the toggle cluster is nested inside it.
    render(<AppControls><a href="/x">account</a></AppControls>);
    const root = screen.getByText('account').parentElement!;
    const order = Array.from(root.children).map((c) => c.textContent);
    expect(order[0]).toBe('account');
  });

  it('keeps the toggle cluster non-shrinking regardless of a leading slot', () => {
    // The manage-layout overflow bug (fixed here) happened because the cluster COULD be
    // asked to shrink. Whatever the root's own shrink behaviour, the cluster wrapper
    // itself must always carry shrink-0, on every render shape.
    //
    // Assert against the cluster wrapper directly — `[role="group"]`'s parent — not via
    // `.shrink-0` anywhere in the subtree. The shadcn primitives (button.tsx, toggle-group)
    // already carry shrink-0 internally, so a bare `.querySelector('.shrink-0')` always
    // matches something regardless of whether the wrapper itself has the class: it doesn't
    // kill the mutation of removing shrink-0 from the wrapper.
    const { container: withSlot } = render(<AppControls><a href="/x">account</a></AppControls>);
    const { container: withoutSlot } = render(<AppControls />);
    expect(withSlot.querySelector('[role="group"]')!.parentElement).toHaveClass('shrink-0');
    expect(withoutSlot.querySelector('[role="group"]')!.parentElement).toHaveClass('shrink-0');
  });

  it("gives the root min-w-0 only when there's a leading slot to absorb the squeeze", () => {
    // Without a leading slot, nothing else in AppControls can shrink, so the root itself
    // must stay shrink-0 immune — the surrounding page's own sibling (e.g. member-header's
    // club name) is what's supposed to absorb the squeeze instead. With a leading slot,
    // the root must be allowed to shrink (min-w-0) so that slot can be compressed.
    const { container: withSlot } = render(<AppControls><a href="/x">account</a></AppControls>);
    const { container: withoutSlot } = render(<AppControls />);
    expect(withSlot.firstElementChild).toHaveClass('min-w-0');
    expect(withSlot.firstElementChild).not.toHaveClass('shrink-0');
    expect(withoutSlot.firstElementChild).toHaveClass('shrink-0');
    expect(withoutSlot.firstElementChild).not.toHaveClass('min-w-0');
  });
});
