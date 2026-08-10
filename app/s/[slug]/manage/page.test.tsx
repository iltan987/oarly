// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buttonVariants } from '@/components/ui/button';
import type * as RosterModule from '@/lib/roster';

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails and
// takes the whole FILE down — `0 test`, which is an absent assertion, not a failing one.
// The page also queries it directly (pending-membership count), so the mock has to be
// a chain that resolves, not just `{}`.
const pendingCount = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ n: pendingCount.n }]),
      }),
    }),
  },
}));

const { requireOwner, listSkillLevels, listBoats, listWindowsWithBoats, getDayRoster } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listSkillLevels: vi.fn(),
  listBoats: vi.fn(),
  listWindowsWithBoats: vi.fn(),
  getDayRoster: vi.fn(),
}));
vi.mock('@/lib/membership', () => ({ requireOwner }));
vi.mock('@/lib/skill-levels', () => ({ listSkillLevels }));
vi.mock('@/lib/boats', () => ({ listBoats }));
vi.mock('@/lib/schedule', () => ({ listWindowsWithBoats }));
vi.mock('@/lib/roster', async (importOriginal) => ({
  ...await importOriginal<typeof RosterModule>(),
  getDayRoster,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
}));

import ManageOverviewPage from './page';

const CLUB = { id: 'club-1', timezone: 'UTC', tagline: null, description: null };

async function renderPage() {
  render(await ManageOverviewPage({ params: Promise.resolve({ slug: 'bebek' }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingCount.n = 0;
  requireOwner.mockResolvedValue({ club: CLUB, user: { id: 'u1' } });
  listSkillLevels.mockResolvedValue([]);
  listBoats.mockResolvedValue([]);
  listWindowsWithBoats.mockResolvedValue([]);
  getDayRoster.mockResolvedValue({ closed: false, sessions: [] });
});

/**
 * Both branches of this page used to render `<Button render={<Link/>}>`, which logs a
 * Base UI dev-console error on every render (`nativeButton` defaults to true) — see
 * `bookings-list.tsx`'s `Section` prop for the full history. `getByRole('link')` alone
 * would pass whether the fix used `buttonVariants` or dropped the styling entirely, so
 * every case here also pins the className to an exact `buttonVariants(...)` call —
 * `toContain` would still pass if `variant`/`size` were flattened to the wrong constant.
 */
describe('ManageOverviewPage — setup checklist', () => {
  function linkTo(href: string): HTMLElement {
    const link = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === href);
    if (!link) throw new Error(`no link to ${href}`);
    return link;
  }

  it('links each todo item through buttonVariants, not a bare Link', async () => {
    await renderPage();
    const link = linkTo('/manage/skill-levels');
    expect(link.tagName).toBe('A');
    expect(link.textContent).toBe('setupTodo');
    expect(link.className).toBe(buttonVariants({ size: 'sm', variant: 'outline' }));
  });

  it('switches a done item to the done label and the ghost variant', async () => {
    listSkillLevels.mockResolvedValue([{ id: 'l1', clubId: CLUB.id, name: 'Beginner', rank: 1 }]);
    await renderPage();
    const link = linkTo('/manage/skill-levels');
    expect(link.textContent).toBe('setupDone');
    expect(link.className).toBe(buttonVariants({ size: 'sm', variant: 'ghost' }));
  });
});

describe('ManageOverviewPage — overview', () => {
  beforeEach(() => {
    // Every checklist item done, so the page renders its second branch instead.
    listSkillLevels.mockResolvedValue([{ id: 'l1', clubId: CLUB.id, name: 'Beginner', rank: 1 }]);
    listBoats.mockResolvedValue([{ id: 'b1', clubId: CLUB.id, name: 'Single', seats: 1, active: true, allowedPayment: 'both', minAttendance: null, minSkillLevelId: null }]);
    listWindowsWithBoats.mockResolvedValue([{ id: 'w1', clubId: CLUB.id, weekday: 1, startTime: '09:00', endTime: '17:00', defaultSessionMinutes: 60, boats: [] }]);
    requireOwner.mockResolvedValue({ club: { ...CLUB, tagline: 'Kürek kulübü' }, user: { id: 'u1' } });
  });

  it('outlines the members link when a request is pending', async () => {
    pendingCount.n = 3;
    await renderPage();
    const link = screen.getByRole('link', { name: 'requestsCta' });
    expect(link.getAttribute('href')).toBe('/manage/members');
    expect(link.className).toBe(buttonVariants({ size: 'sm', variant: 'outline' }));
  });

  it('ghosts the members link when nothing is pending', async () => {
    pendingCount.n = 0;
    await renderPage();
    const link = screen.getByRole('link', { name: 'requestsCta' });
    expect(link.className).toBe(buttonVariants({ size: 'sm', variant: 'ghost' }));
  });

  it('links today\'s bookings through buttonVariants', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: 'todayCta' });
    expect(link.getAttribute('href')).toBe('/manage/bookings');
    expect(link.className).toBe(buttonVariants({ size: 'sm', variant: 'ghost' }));
  });
});
