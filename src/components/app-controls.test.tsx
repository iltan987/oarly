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
    render(<AppControls><a href="/x">account</a></AppControls>);
    const rendered = screen.getByRole('group', { name: 'language' }).parentElement!;
    const order = Array.from(rendered.children).map((c) => c.textContent);
    expect(order[0]).toBe('account');
  });
});
