// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Row = { id: string; name: string; slug: string; status: string };

// One mutable row list so each test renders exactly one club and can query globally.
let rows: Row[] = [];

vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ orderBy: () => Promise.resolve(rows) }) }) },
}));

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which controls render, not about copy. The catalogs are checked
// separately below.
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

vi.mock('./club-status-button', () => ({
  ClubStatusButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock('./created-toast', () => ({ CreatedToast: () => null }));

import AdminClubsPage from './page';

async function renderClub(status: string) {
  rows = [{ id: 'c1', name: 'Boğaziçi Kürek', slug: 'bogazici', status }];
  render(await AdminClubsPage({ searchParams: Promise.resolve({}) }));
}

describe('AdminClubsPage status controls', () => {
  // The un-reject hole. `setClubStatus` is id-keyed and now refuses a rejected row, but
  // this page is what decides whether an admin is ever offered the button — and a
  // rejected club may share its slug with a live one, so "Activate" here is a control
  // whose best outcome is a unique-violation.
  it('offers no status control on a rejected club', async () => {
    await renderClub('rejected');
    expect(screen.queryByRole('button', { name: 'activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'suspend' })).toBeNull();
  });

  // The other half of the same regression: with no `rejected` entry in the label map the
  // pill renders `undefined` — a visibly empty badge next to a real club name. The tone
  // is asserted alongside the label because it is the same bug's visual half: a
  // `rejected` pill painted with the `ok` tone is a green badge reading "Rejected".
  it('labels a rejected club instead of rendering an empty pill, in a non-affirmative tone', async () => {
    await renderClub('rejected');
    const pill = screen.getByText('statusRejected');
    expect(pill).toBeInTheDocument();
    // `neutral` — see `toneClass` in booking-status-badge.
    expect(pill).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(pill).not.toHaveClass('bg-ok-bg');
  });

  // A pending club is decided in the requests queue, never by this toggle: offering
  // "Activate" here would be an approve path that skips the review stamp entirely and
  // now fails with `not_decided`.
  it('offers no status control on a pending club', async () => {
    await renderClub('pending');
    expect(screen.getByText('statusPending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'activate' })).toBeNull();
  });

  it('still offers Suspend on an active club and Activate on a suspended one', async () => {
    await renderClub('active');
    expect(screen.getByRole('button', { name: 'suspend' })).toBeInTheDocument();

    screen.getByText('statusActive'); // sanity: the pill is labelled

    await renderClub('suspended');
    expect(screen.getByRole('button', { name: 'activate' })).toBeInTheDocument();
  });
});

describe('admin message catalogs', () => {
  // Turkish is the app default, so an English-only key ships as a missing-message
  // warning to every real user.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the new admin keys', (_locale, messages) => {
    expect(messages.admin.statusRejected).toBeTruthy();
    expect(messages.admin.errorNotDecided).toBeTruthy();
  });
});
