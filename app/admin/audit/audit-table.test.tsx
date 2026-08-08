// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AuditRow } from '@/lib/audit';

import en from '../../../messages/en.json';
import tr from '../../../messages/tr.json';
import { AuditTable } from './audit-table';

const labels = {
  when: 'when', actor: 'actor', club: 'club', action: 'action', target: 'target', empty: 'empty', unknown: '—',
  role: 'role', roles: { owner: 'Club owner', member: 'Member', admin: 'Platform admin' },
  cascadeNote: 'cascade-note',
};

function row(overrides: Partial<AuditRow>): AuditRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-08-08T09:00:00Z'),
    action: 'club.suspend',
    target: 'abc',
    actingAsRole: 'admin',
    actorUserId: 'u1',
    actorName: 'Ada',
    actorEmail: 'ada@example.com',
    clubId: 'c1',
    clubName: 'Boğaziçi',
    ...overrides,
  };
}

describe('AuditTable', () => {
  it('renders a row whose actor and club are both null without crashing', () => {
    const orphan = row({
      id: '22222222-2222-2222-2222-222222222222',
      actorUserId: null, actorName: null, actorEmail: null,
      clubId: null, clubName: null,
    });
    render(<AuditTable rows={[orphan]} labels={labels} locale="en" timeZone="UTC" />);

    // The row is still evidence: its action and target must be on screen…
    expect(screen.getByText('club.suspend')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
    // …and the two missing subjects render as the placeholder, not as a crash.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  // The middle rung of the fallback chain: the account is gone but the id the row
  // recorded is not, and that id is the only handle an operator has left.
  it('falls back to the raw actor and club ids when only the names are missing', () => {
    render(<AuditTable rows={[row({ actorName: null, actorEmail: null, clubName: null })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('u1')).toBeInTheDocument();
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders the actor name and club name when they resolve', () => {
    render(<AuditTable rows={[row({})]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Boğaziçi')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders the target verbatim rather than resolving it', () => {
    render(<AuditTable rows={[row({ target: 'not-a-real-id' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('not-a-real-id')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(<AuditTable rows={[]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  // Spec §4.1 spent an `ALTER TYPE … ADD VALUE` migration so this column can say
  // `admin`. It was written on every row and rendered on none, so the page showed
  // "member.approve — actor: Ayşe" about someone who is both a club owner and a
  // platform admin, and refused to say which authority she used.
  it('renders which role the actor was acting in', () => {
    render(<AuditTable rows={[row({ actingAsRole: 'admin' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('Platform admin')).toBeInTheDocument();
  });

  it('renders the same action performed as an owner differently', () => {
    render(<AuditTable rows={[row({ action: 'member.approve', actingAsRole: 'owner' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('Club owner')).toBeInTheDocument();
    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument();
  });

  it('falls back to the raw role value rather than blank, and to the placeholder for null', () => {
    // A pre-cycle row has a null `acting_as_role`; a row written by a future version
    // may carry a value this catalog does not know. Both are still evidence (§4.4).
    render(<AuditTable rows={[row({ actingAsRole: null })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // One `attendance.noshow` row stands for the ban, every booking the ban cancelled,
  // and every waitlister promoted into the seats it freed. Spec §4.2 mandates one row
  // per function, so the note says what the row means instead of inventing more rows.
  it('marks a cascade-capable action so one row is not read as one change', () => {
    render(<AuditTable rows={[row({ action: 'attendance.noshow' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('cascade-note')).toBeInTheDocument();
  });

  it('does not mark an action that changes exactly one thing', () => {
    render(<AuditTable rows={[row({ action: 'club.suspend' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.queryByText('cascade-note')).not.toBeInTheDocument();
  });
});

describe('audit message catalogs', () => {
  // Turkish is the app default, so a key added to en.json alone ships as a
  // missing-message warning to every real user. Both catalogs are asserted by the
  // same list for that reason — a test that mocks next-intl would never notice.
  const keys = [
    'audit', 'users', 'auditWhen', 'auditActor', 'auditClub', 'auditAction', 'auditTarget',
    'auditEmpty', 'auditUnknown', 'auditFilterClub', 'auditFilterActor', 'auditFilterAction',
    'auditApply', 'auditClear', 'auditNext', 'auditFirst',
    'auditRole', 'auditCascadeNote', 'roleOwner', 'roleMember', 'roleAdmin',
    'detailNoAudit', 'clubsNoMatch',
  ] as const;

  it.each([['en', en], ['tr', tr]] as const)('%s carries every audit key', (_locale, messages) => {
    const admin: Record<string, unknown> = messages.admin;
    // Asserted as a list rather than key-by-key so a failure names every key that
    // is missing from this catalog, not just the first one.
    expect(keys.filter((key) => !admin[key])).toEqual([]);
  });
});
