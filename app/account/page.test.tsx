// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUser, notFound, selectWhere } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  selectWhere: vi.fn(),
}));

/** The row `db.select(...)` resolves to. `[]` models a session pointing at a deleted user. */
let rows: Record<string, unknown>[] = [];

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (clause: unknown) => {
          selectWhere(clause);
          return { limit: () => Promise.resolve(rows) };
        },
      }),
    }),
  },
}));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/session', () => ({ requireUser }));
vi.mock('@/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ saveAccountAction: vi.fn() }));
// Stubbed for the reason app/admin/layout.test.tsx stubs it: the menu is a client component
// with its own suite, and rendering it here would drag next-themes into this test for
// nothing. `menu-session.test.ts` covers the host-correct Account link separately.
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));

import { PgDialect } from 'drizzle-orm/pg-core';

import AccountPage from './page';

const SESSION_USER = { id: 'user-1', name: 'İltan Caner', email: 'member@example.com', image: null };

/** A full row, with the two never-collected columns NULL as every pre-existing row has them. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    email: 'member@example.com',
    firstName: 'İltan',
    lastName: 'Caner',
    phone: '5551112233',
    birthday: null,
    gender: null,
    defaultPaymentType: 'regular',
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(SESSION_USER);
  rows = [row()];
});

describe('AccountPage', () => {
  /**
   * Asserted first and separately, because it is the failure mode everything else in this
   * file would hide: an async component nested in one of `AppShell`'s PROPS makes
   * `render(await Page())` produce an empty div with NO error, and every query below would
   * then fail for a reason that has nothing to do with what it is testing. `AppWordmark` and
   * `AppFooter` are both synchronous precisely so this holds — see `app-brand.tsx`.
   */
  it('renders real DOM, not the empty div an async component in a prop produces', async () => {
    const { container } = render(await AccountPage());

    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument(); // the shared footer
  });

  // `width="2xl"`, matching the other apex content surfaces. Asserted on the `<main>` by
  // ROLE rather than by a class selector, which could match a nested primitive instead.
  it('mounts in the shared shell at the 2xl content width', async () => {
    render(await AccountPage());
    expect(screen.getByRole('main')).toHaveClass('max-w-2xl');
  });

  /**
   * The row is selected by the SESSION user's id. Read out of the real SQL the drizzle
   * `eq()` compiles to, rather than trusted — this is the read-side half of the same
   * authorization story `actions.test.ts` pins on the write side.
   */
  it('reads the row belonging to the signed-in user', async () => {
    await AccountPage();

    expect(requireUser).toHaveBeenCalledWith('/account');
    const compiled = new PgDialect().sqlToQuery(vi.mocked(selectWhere).mock.calls[0][0] as never);
    expect(compiled.sql).toContain('"user"."id" =');
    expect(compiled.params).toEqual(['user-1']);
  });

  /**
   * The silent-blank hazard. `birthday` is NULL on every row that predates this page, and
   * `<input type="date">` renders both a NULL and a `Date` as an empty field with no error
   * — so "empty" alone proves nothing. Both directions are asserted: NULL renders empty AND
   * a stored `'YYYY-MM-DD'` string renders populated. Hand the input a Better-Auth-shaped
   * `Date` instead and the second assertion fails.
   */
  it('renders a NULL birthday empty and a stored one populated', async () => {
    const blank = render(await AccountPage());
    expect(screen.getByLabelText('birthday')).toHaveValue('');
    blank.unmount();

    rows = [row({ birthday: '1990-04-17' })];
    render(await AccountPage());
    expect(screen.getByLabelText('birthday')).toHaveValue('1990-04-17');
  });

  it('renders a NULL gender as "not set", never as prefer_not_to_say', async () => {
    render(await AccountPage());
    const trigger = screen.getByRole('combobox', { name: 'gender' });
    expect(trigger).toHaveTextContent('genderUnset');
    expect(trigger).not.toHaveTextContent('genderPreferNotToSay');
  });

  // Google sign-in never fills these three, so they are nullable too and must not reach an
  // uncontrolled input as `null` — React would warn and the field would go uncontrolled.
  it('flattens NULL name and phone columns to empty fields', async () => {
    rows = [row({ firstName: null, lastName: null, phone: null })];
    render(await AccountPage());

    expect(screen.getByLabelText('firstName')).toHaveValue('');
    expect(screen.getByLabelText('lastName')).toHaveValue('');
    expect(screen.getByLabelText('phone')).toHaveValue('');
  });

  it('shows the email the row carries, read-only', async () => {
    render(await AccountPage());
    const email = screen.getByLabelText('email');
    expect(email).toHaveValue('member@example.com');
    expect(email).toBeDisabled();
  });

  // A live session pointing at a deleted row: rendering a blank form would invite a "save"
  // into a row that no longer exists.
  it('404s when the session names a row that is gone', async () => {
    rows = [];
    await expect(AccountPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
