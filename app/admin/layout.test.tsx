// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock('@/lib/session', () => ({ requireAdmin: () => Promise.resolve({ id: 'a1' }) }));
vi.mock('@/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('@/lib/urls', () => ({ apexUrl: () => '/sign-in', parseAppOrigin: () => ({}) }));
vi.mock('@/components/sign-out-button', () => ({ SignOutButton: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('./_nav', () => ({ AdminNav: () => null }));

import AdminLayout from './layout';

describe('AdminLayout', () => {
  /**
   * The console title had heading typography and no heading semantics, which made
   * /admin the only section of the product with no <h1> — nothing in a screen
   * reader's heading list and no document outline on any console page.
   */
  it('renders the console title as a real heading', async () => {
    render(await AdminLayout({ children: <p>body</p> }));
    expect(screen.getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
  });

  it('keeps the title a link back to the clubs list', async () => {
    render(await AdminLayout({ children: <p>body</p> }));
    expect(screen.getByRole('link', { name: 'title' })).toHaveAttribute('href', '/admin');
  });
});
