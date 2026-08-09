// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RestrictionModule from '@/lib/restriction';

const { requireClub, getCurrentUser, getMembership, getRestriction } = vi.hoisted(() => ({
  requireClub: vi.fn(),
  getCurrentUser: vi.fn(),
  getMembership: vi.fn(),
  getRestriction: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/tenant', () => ({ requireClub }));
vi.mock('@/lib/session', () => ({ getCurrentUser }));
vi.mock('@/lib/membership', () => ({ getMembership }));
vi.mock('@/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
/**
 * `getRestriction` is mocked; `viewerKindOf` is NOT. The precedence table is the thing
 * under test on this page, and a mocked `viewerKindOf` would make every case below assert
 * only that the page reads a map it was handed.
 */
vi.mock('@/lib/restriction', async (importOriginal) => ({
  ...(await importOriginal<typeof RestrictionModule>()),
  getRestriction,
}));
/** Async server component: stubbed, and publishes its props. See `app/page.test.tsx`. */
vi.mock('@/components/restriction-notice', () => ({
  RestrictionNotice: ({ restriction, timeZone, clubPhone, variant }: { restriction: { state: string }; timeZone: string; clubPhone?: string | null; variant?: string }) => (
    <span data-testid="notice" data-state={restriction.state} data-tz={timeZone} data-phone={clubPhone ?? ''} data-variant={variant} />
  ),
}));
/**
 * The user menu is the whole signed-in chrome — Account, Sign out, language, theme. It is
 * a client component with its own suite, so it is stubbed here down to the ONE fact this
 * page owns: whether it handed the menu a session.
 */
vi.mock('@/components/user-menu', () => ({
  UserMenu: ({ session }: { session?: { email: string } }) =>
    session ? <span data-testid="menu">{session.email}</span> : <span data-testid="menu-guest" />,
}));

import ClubPublicPage from './page';

const CLUB = {
  id: 'club-1',
  slug: 'bebek',
  name: 'Bebek Rowing',
  logoUrl: null,
  tagline: null,
  description: null,
  phone: '0212 555 44 33',
  timezone: 'Europe/Istanbul',
  brandAccent: null,
  status: 'active',
};
const USER = { id: 'user-1', name: 'İltan Caner', email: 'member@example.com', image: null };

function membership(over: Record<string, unknown> = {}) {
  return { id: 'm-1', role: 'member', status: 'approved', bannedUntil: null, ...over };
}

async function renderPage() {
  return render(await ClubPublicPage({ params: Promise.resolve({ slug: 'bebek' }) }));
}

/**
 * Scoped to `<main>`, not the document: `AppFooter` is a sibling of it and contributes two
 * apex links to every page. Including them would make `toEqual` assertions here about the
 * footer as much as about the CTA table, and they would change whenever the footer does.
 */
function hrefs(): string[] {
  return [...screen.getByRole('main').querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  requireClub.mockResolvedValue(CLUB);
  getCurrentUser.mockResolvedValue(USER);
  getMembership.mockResolvedValue(membership());
  getRestriction.mockResolvedValue({ state: 'none' });
});

describe('the club landing page', () => {
  it('renders real DOM, not the empty div an async component in a prop produces', async () => {
    const { container } = render(await ClubPublicPage({ params: Promise.resolve({ slug: 'bebek' }) }));

    expect(container.querySelector('main')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Bebek Rowing' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  /**
   * C1 — the one-line sign-out fix, verified rather than re-applied. Task 3 replaced the
   * sign-out-less `<AppControls />` this page used to render with the shared `UserMenu`;
   * what remained to check is that a signed-in viewer is handed a SESSION, since
   * `UserMenu` treats an absent one as "guest" and renders neither Account nor Sign out.
   */
  it('gives a signed-in viewer a user menu with their session', async () => {
    await renderPage();
    expect(screen.getByTestId('menu')).toHaveTextContent('member@example.com');
  });

  it('gives a signed-out viewer the guest menu', async () => {
    getCurrentUser.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByTestId('menu-guest')).toBeInTheDocument();
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
  });

  it('offers a stranger the join door and nothing else', async () => {
    getCurrentUser.mockResolvedValue(null);
    getMembership.mockResolvedValue(null);
    await renderPage();

    expect(hrefs()).toContain('/join');
    expect(screen.getByText('ctaRequestJoin')).toBeInTheDocument();
  });

  it('offers a rejected applicant the note and the join door again', async () => {
    getMembership.mockResolvedValue(membership({ status: 'rejected' }));
    await renderPage();

    expect(screen.getByText('noteRejected')).toBeInTheDocument();
    expect(hrefs()).toContain('/join');
  });

  /**
   * `pending` is the one branch with no link, and deliberately so: `requireMemberView`
   * admits `approved` and `banned` only, so `/book` and `/bookings` would 404 a pending
   * applicant. Pinned because "every kind has a destination" is otherwise a tempting
   * tidy-up.
   */
  it('offers a pending applicant a status and no destination', async () => {
    getMembership.mockResolvedValue(membership({ status: 'pending' }));
    await renderPage();

    expect(screen.getByText('statusPending')).toBeInTheDocument();
    expect(screen.getByText('notePending')).toBeInTheDocument();
    expect(hrefs()).not.toContain('/book');
    expect(hrefs()).not.toContain('/bookings');
  });

  // Both destinations, and in this order: an approved member's calendar leads.
  it('sends an approved member to the calendar first and their bookings second', async () => {
    await renderPage();
    expect(hrefs()).toEqual(['/book', '/bookings']);
  });

  it('sends an approved owner to the console first and the calendar second', async () => {
    getMembership.mockResolvedValue(membership({ role: 'owner' }));
    await renderPage();
    expect(hrefs()).toEqual(['/manage', '/book']);
  });

  /**
   * THE bug this task exists to close. `/book` and `/bookings` both guard with
   * `requireMemberView`, which already admits a restricted member — its doc comment says
   * outright "A banned member must still be able to see why" — so both pages have always
   * worked for them. NOTHING LINKED TO THEM. A restricted member's page was a red pill
   * and a sentence, and that was the whole dead end.
   */
  it('gives a restricted member an explanation and both destinations', async () => {
    getMembership.mockResolvedValue(membership({ bannedUntil: new Date('2026-08-12T04:00:00Z') }));
    getRestriction.mockResolvedValue({ state: 'paused', endsAt: new Date('2026-08-12T04:00:00Z'), cause: null });
    await renderPage();

    expect(screen.getByTestId('notice')).toHaveAttribute('data-state', 'paused');
    expect(hrefs()).toEqual(['/bookings', '/book']);
  });

  /**
   * The ORDER above is the point, so it gets its own assertion against the approved
   * member's. "My bookings" is primary for a restricted member and secondary for an
   * approved one: the restricted member's useful destination is the record of what they
   * had — including the seats the penalty cancelled — not a calendar on which every
   * session reads "ineligible". Swap the two links and this fails while the presence
   * check above still passes.
   */
  it('leads a restricted member with their bookings and an approved one with the calendar', async () => {
    const approved = await renderPage();
    expect(hrefs()[0]).toBe('/book');
    approved.unmount();

    getRestriction.mockResolvedValue({ state: 'suspended', cause: null });
    await renderPage();
    expect(hrefs()[0]).toBe('/bookings');
  });

  // The phone is the only actionable thing for a suspension, and this page is the only
  // surface that has it — `clubs.phone` already renders publicly here.
  it('hands the notice the club phone and the club timezone', async () => {
    getRestriction.mockResolvedValue({ state: 'suspended', cause: null });
    await renderPage();

    const notice = screen.getByTestId('notice');
    expect(notice).toHaveAttribute('data-phone', '0212 555 44 33');
    expect(notice).toHaveAttribute('data-tz', 'Europe/Istanbul');
    expect(notice).toHaveAttribute('data-variant', 'card');
  });

  /**
   * A restricted OWNER gets the member's doors, not the console — `viewerKindOf` puts the
   * restriction above the owner role, and this is the page where that decision is visible.
   */
  it('does not offer the console to a restricted owner', async () => {
    getMembership.mockResolvedValue(membership({ role: 'owner', status: 'banned' }));
    getRestriction.mockResolvedValue({ state: 'suspended', cause: null });
    await renderPage();

    expect(hrefs()).not.toContain('/manage');
    expect(screen.getByTestId('notice')).toBeInTheDocument();
  });

  /**
   * Deliverable E on the surface that would have shown the false sentence. An owner
   * rejects someone already serving a timed pause; `restrictionState` still calls that
   * row `paused`, so leading with the restriction would promise "you can book again on
   * 12 August" to somebody who was never admitted.
   */
  it('tells a rejected applicant they were rejected, not that they are paused', async () => {
    getMembership.mockResolvedValue(membership({ status: 'rejected', bannedUntil: new Date('2026-08-12T04:00:00Z') }));
    getRestriction.mockResolvedValue({ state: 'paused', endsAt: new Date('2026-08-12T04:00:00Z'), cause: null });
    await renderPage();

    expect(screen.queryByTestId('notice')).not.toBeInTheDocument();
    expect(screen.getByText('noteRejected')).toBeInTheDocument();
    expect(hrefs()).toContain('/join');
  });

  /** The unrestricted member's page must cost no restriction query beyond the free one. */
  it('asks about the restriction once, and never for a stranger', async () => {
    await renderPage();
    expect(getRestriction).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(null);
    getMembership.mockResolvedValue(null);
    await renderPage();
    expect(getRestriction).not.toHaveBeenCalled();
  });
});
