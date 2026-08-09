// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock('@/lib/membership', () => ({
  requireOwner: () =>
    Promise.resolve({
      club: { name: 'Boğaziçi Kürek Kulübü', logoUrl: null },
      user: { name: 'İltan Caner', email: 'i@c.test', image: null },
    }),
}));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://oarly.test' } }));
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('./_nav', () => ({ ManageNav: () => null }));

import ManageLayout from './layout';

async function renderLayout() {
  render(await ManageLayout({ children: <p>body</p>, params: Promise.resolve({ slug: 'bkk' }) }));
}

describe('ManageLayout', () => {
  /**
   * The title used to sit in the same row as the page controls, and being a `text-2xl`
   * `<h1>` there is what pushed the control cluster's vertical position out of line with
   * every other surface. Moving it into the content column must not cost it its
   * semantics: it is still the manage section's only <h1>.
   */
  it('keeps the manage title an h1 in the content column', async () => {
    await renderLayout();
    const heading = screen.getByRole('heading', { level: 1, name: 'title' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(heading);
    expect(screen.getByRole('banner')).not.toContainElement(heading);
  });

  it('shows the club, not the product, as the header brand on a tenant host', async () => {
    await renderLayout();
    expect(screen.getByRole('banner')).toHaveTextContent('Boğaziçi Kürek Kulübü');
  });
});
