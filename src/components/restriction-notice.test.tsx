// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `t(key)` returns the key; `t(key, values)` returns `key(a=1,b=2)`. Asserting on the KEY
 * rather than on a colour class is the whole point of this file's assertions:
 * `StatusPill` applies `bg-warn-bg text-warn` through `cn`, so
 * `container.querySelector('.bg-warn-bg')` matches the NESTED pill and passes even when
 * the notice's own container is the wrong colour — a test that can never fail. The
 * translated key differs per state, so it cannot pass for the wrong state.
 */
const { dateTimeCalls } = vi.hoisted(() => ({ dateTimeCalls: [] as { date: Date; opts: Record<string, unknown> }[] }));

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key,
    ),
  getFormatter: () =>
    Promise.resolve({
      dateTime: (date: Date, opts: Record<string, unknown>) => {
        dateTimeCalls.push({ date, opts });
        // Two distinguishable shapes, so a test can tell "the day" from "the clock" and a
        // swap of the two arguments is visible in the rendered text.
        return opts.hour ? `CLOCK<${date.toISOString()}>` : `DAY<${date.toISOString()}>`;
      },
    }),
}));

import type { Restriction } from '@/lib/restriction';

import { RestrictionNotice, RestrictionNoticeView } from './restriction-notice';

const ENDS_AT = new Date('2026-08-12T04:00:00.000Z');
const SESSION_AT = new Date('2026-08-05T04:00:00.000Z');

function view(overrides: Partial<Parameters<typeof RestrictionNoticeView>[0]> = {}) {
  return (
    <RestrictionNoticeView
      state="paused"
      title="pausedTitle"
      lead="pausedUntil"
      cause="causeNoShow"
      contact={null}
      phone={null}
      variant="card"
      {...overrides}
    />
  );
}

beforeEach(() => {
  dateTimeCalls.length = 0;
});

describe('RestrictionNoticeView', () => {
  it('renders real DOM with a status role at the root', () => {
    const { container } = render(view());

    // Asserted before anything else: `getByRole` throwing for a missing role and
    // `getByRole` throwing because the tree never rendered look identical in a failure
    // report, and the second is what an async component in a prop produces.
    expect(container.firstElementChild).not.toBeNull();
    expect(screen.getByRole('status')).toBe(container.firstElementChild);
  });

  /**
   * The state test, and the reason every string here is a key. Both directions are
   * asserted — "paused is present" alone passes for a component that renders both.
   */
  it('says paused for a pause and never says suspended', () => {
    render(view({ state: 'paused', title: 'pausedTitle', lead: 'pausedUntil' }));

    expect(screen.getByText('pausedTitle')).toBeInTheDocument();
    expect(screen.getByText('pausedUntil')).toBeInTheDocument();
    expect(screen.queryByText('suspendedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('suspendedBody')).not.toBeInTheDocument();
  });

  it('says suspended for a suspension and never says paused', () => {
    render(view({ state: 'suspended', title: 'suspendedTitle', lead: 'suspendedBody' }));

    expect(screen.getByText('suspendedTitle')).toBeInTheDocument();
    expect(screen.getByText('suspendedBody')).toBeInTheDocument();
    expect(screen.queryByText('pausedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('pausedUntil')).not.toBeInTheDocument();
  });

  /**
   * Tone read off the ROOT, which `getByRole('status')` returns by identity — not off a
   * `.bg-warn-bg` selector, which would also match the pill nested inside it and could
   * not distinguish a correct container from a wrong one.
   */
  it('carries the warn surface for a pause and the bad surface for a suspension', () => {
    const paused = render(view({ state: 'paused' }));
    expect(screen.getByRole('status').className).toContain('bg-warn-bg');
    expect(screen.getByRole('status').className).not.toContain('bg-bad-bg');
    paused.unmount();

    render(view({ state: 'suspended' }));
    expect(screen.getByRole('status').className).toContain('bg-bad-bg');
    expect(screen.getByRole('status').className).not.toContain('bg-warn-bg');
  });

  it('drops the cause line rather than inventing one when no penalty explains the state', () => {
    render(view({ cause: null }));
    expect(screen.queryByText('causeNoShow')).not.toBeInTheDocument();
    // The notice still exists — a missing cause must not blank the whole thing.
    expect(screen.getByText('pausedTitle')).toBeInTheDocument();
  });

  it('dials the phone it is given and shows the number the club published', () => {
    render(
      view({
        state: 'suspended',
        contact: 'contact',
        phone: { text: '0212 555 44 33', href: 'tel:02125554433', label: 'callClub(phone=0212 555 44 33)' },
      }),
    );

    const link = screen.getByRole('link', { name: 'callClub(phone=0212 555 44 33)' });
    expect(link).toHaveAttribute('href', 'tel:02125554433');
    // WCAG 2.5.3: the accessible name has to contain the visible label.
    expect(link).toHaveTextContent('0212 555 44 33');
  });

  it('still renders the contact sentence when the club published no number', () => {
    render(view({ state: 'suspended', contact: 'contact', phone: null }));
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('RestrictionNotice', () => {
  const paused: Restriction = {
    state: 'paused',
    endsAt: ENDS_AT,
    cause: { reason: 'no_show', sessionStartAt: SESSION_AT },
  };
  const suspended: Restriction = {
    state: 'suspended',
    cause: { reason: 'no_show', sessionStartAt: SESSION_AT },
  };

  it('renders nothing at all for an unrestricted membership', async () => {
    expect(await RestrictionNotice({ restriction: { state: 'none' }, timeZone: 'Europe/Istanbul' })).toBeNull();
  });

  /**
   * THE reason this component is async and server-side. The apex root page lists clubs in
   * different timezones, so the instant has to be formatted in `club.timezone` and not in
   * the request's — next-intl's global `timeZone` cannot vary per row.
   *
   * Asserted on the OPTIONS the formatter was called with, because the mock's output is
   * the same string either way: a component that dropped `timeZone` would render an
   * identical-looking notice with a date that is wrong by up to a day.
   */
  it('formats both instants in the club timezone, 24-hour', async () => {
    render((await RestrictionNotice({ restriction: paused, timeZone: 'Europe/Istanbul', variant: 'card' }))!);

    expect(dateTimeCalls.length).toBeGreaterThan(0);
    for (const call of dateTimeCalls) expect(call.opts.timeZone).toBe('Europe/Istanbul');

    const clocks = dateTimeCalls.filter((c) => c.opts.hour);
    expect(clocks.length).toBe(2); // the lift time and the missed session's time
    for (const call of clocks) expect(call.opts.hour12).toBe(false);
  });

  /**
   * The `07:00` is the load-bearing half: "12 August" reads as "some time that day".
   * Both arguments are checked, and against the END date rather than merely "some
   * date" — filling `{time}` from the session instant instead would render a
   * plausible sentence naming the wrong hour.
   */
  it('tells a paused member the end date AND the end time', async () => {
    render((await RestrictionNotice({ restriction: paused, timeZone: 'UTC' }))!);

    expect(screen.getByText(`pausedUntil(date=DAY<${ENDS_AT.toISOString()}>,time=CLOCK<${ENDS_AT.toISOString()}>)`))
      .toBeInTheDocument();
  });

  it('names the missed session by date and time', async () => {
    render((await RestrictionNotice({ restriction: paused, timeZone: 'UTC' }))!);

    expect(screen.getByText(`causeNoShow(date=DAY<${SESSION_AT.toISOString()}>,time=CLOCK<${SESSION_AT.toISOString()}>)`))
      .toBeInTheDocument();
  });

  // `penalties.session_id` is `on delete set null`, and a manually-issued penalty has no
  // session at all. Naming no session is honest; a blank date in a sentence is not.
  it('falls back to undated copy when the penalty names no session', async () => {
    const r: Restriction = { state: 'suspended', cause: { reason: 'no_show', sessionStartAt: null } };
    render((await RestrictionNotice({ restriction: r, timeZone: 'UTC' }))!);

    expect(screen.getByText('causeNoShowUndated')).toBeInTheDocument();
    expect(screen.queryByText(/causeNoShow\(/)).not.toBeInTheDocument();
  });

  // `penalties.reason` is free text. Anything that is not exactly `no_show` must not be
  // described as an absence — the member would go looking for a session they did attend.
  it('never describes a non-no-show penalty as an absence', async () => {
    const r: Restriction = { state: 'suspended', cause: { reason: 'other', sessionStartAt: SESSION_AT } };
    render((await RestrictionNotice({ restriction: r, timeZone: 'UTC' }))!);

    expect(screen.getByText('causeOther')).toBeInTheDocument();
    expect(screen.queryByText(/causeNoShow/)).not.toBeInTheDocument();
  });

  it('offers the phone only for a suspension, which is the only state a call can lift', async () => {
    const suspendedRender = render(
      (await RestrictionNotice({ restriction: suspended, timeZone: 'UTC', clubPhone: '0212 555 44 33' }))!,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'tel:02125554433');
    suspendedRender.unmount();

    render((await RestrictionNotice({ restriction: paused, timeZone: 'UTC', clubPhone: '0212 555 44 33' }))!);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('contact')).not.toBeInTheDocument();
  });

  it('keeps a leading + so an international number still dials', async () => {
    render((await RestrictionNotice({ restriction: suspended, timeZone: 'UTC', clubPhone: '+90 (212) 555-4433' }))!);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'tel:+902125554433');
  });

  /**
   * The inline variant rides in a 320px apex row that has an avatar and a link in it
   * already. It carries the state, the lead and the cause — the explanation — and nothing
   * that needs a second line of chrome.
   */
  it('drops the contact line inline, where there is no room and a link already leads to it', async () => {
    render((await RestrictionNotice({ restriction: suspended, timeZone: 'UTC', clubPhone: '0212 555 44 33', variant: 'inline' }))!);

    expect(screen.getByText('suspendedTitle')).toBeInTheDocument();
    expect(screen.getByText('suspendedBody')).toBeInTheDocument();
    expect(screen.queryByText('contact')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
