// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The translation keys are asserted on directly rather than resolved through real
// message files — this test is about wiring (chip presence), not copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => '' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./actions', () => ({
  bookSeatAction: vi.fn(),
}));

import type { MemberCalendarDay, MemberVirtualSession } from '@/lib/member-calendar';

import { BookCalendar } from './book-calendar';

function makeSession(overrides: Partial<MemberVirtualSession> = {}): MemberVirtualSession {
  return {
    sessionId: 's1',
    boatTypeId: 'bt1',
    boatName: 'Quad',
    capacity: 4,
    minAttendance: null,
    minSkillRank: null,
    allowedPayment: 'both',
    occurrence: 0,
    status: 'open',
    persisted: true,
    seatsLeft: 2,
    bookingOpen: true,
    eligibility: { ok: true },
    defaultPayment: 'regular',
    paymentChoices: ['regular', 'multisport'],
    myStatus: 'none',
    myQueuePosition: null,
    bookingOpensAt: null,
    multisportDayTaken: false,
    waitlistLeft: null,
    ...overrides,
  };
}

function makeDay(session: MemberVirtualSession): MemberCalendarDay {
  return {
    dateISO: '2026-08-10',
    weekday: 1,
    closed: false,
    closedReason: null,
    slots: [
      {
        dateISO: '2026-08-10',
        startAt: new Date('2026-08-10T08:00:00Z'),
        endAt: new Date('2026-08-10T09:00:00Z'),
        windowId: 'w1',
        persisted: true,
        sessions: [session],
      },
    ],
  };
}

describe('BookCalendar payment chips', () => {
  it('shows a chip per payment choice when more than one is offered', () => {
    const days = [makeDay(makeSession({ paymentChoices: ['regular', 'multisport'] }))];
    render(<BookCalendar slug="club" days={days} timeZone="UTC" />);
    expect(screen.getByText('paymentRegular')).toBeInTheDocument();
    expect(screen.getByText('paymentMultisport')).toBeInTheDocument();
  });

  // The gap this test closes: the radio picker in the confirm dialog already
  // self-hides when only one payment type is possible (paymentChoices.length === 1)
  // — e.g. every session at a club with MultiSport disabled — but these chips did
  // not, so a lone redundant "Cash" badge kept rendering on every session card.
  it('hides the chips entirely when only one payment type is possible', () => {
    const days = [makeDay(makeSession({ paymentChoices: ['regular'], defaultPayment: 'regular' }))];
    render(<BookCalendar slug="club" days={days} timeZone="UTC" />);
    expect(screen.queryByText('paymentRegular')).not.toBeInTheDocument();
    expect(screen.queryByText('paymentMultisport')).not.toBeInTheDocument();
  });
});
