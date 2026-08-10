// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The translator echoes its key AND its ICU arguments, so the summaries can be asserted
 * on the NUMBERS they were handed rather than on Turkish copy that a later task is free
 * to reword. `settings.boatsSummary {"count":4,"active":2}` is the whole claim of the row.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key),
}));

vi.mock('@/db', () => ({ db: {} }));

const club = vi.hoisted(() => ({
  value: {
    id: 'club-1',
    tagline: 'Since 1953',
    description: null,
    logoUrl: null,
    bookingOpenMode: 'lead' as const,
    bookingOpenLeadDays: 3,
    selfCancelEnabled: true,
    cancelCutoffHours: 8,
    noshowPenalty: '1w' as const,
    waitlistCapacity: 5,
  },
}));
vi.mock('@/lib/membership', () => ({ requireOwner: () => Promise.resolve({ club: club.value }) }));

/**
 * The query gate.
 *
 * Every mocked query registers itself and then waits on one shared promise that is only
 * released when ALL of them have registered. Four queries issued together release it
 * immediately; four `await`ed one after another cannot — the first one would block
 * forever. Rather than hang the suite, a 50ms timer releases the gate and sets
 * `timedOut`, which is the assertion. So `expect(timedOut).toBe(false)` is a real
 * statement about concurrency, not about call counts.
 */
const EXPECTED_QUERIES = 4;
let started: string[] = [];
let timedOut = false;
let timer: ReturnType<typeof setTimeout>;
let allStarted: Promise<void>;
let release: () => void;

function query<T>(name: string, value: T): Promise<T> {
  started.push(name);
  if (started.length === EXPECTED_QUERIES) release();
  return allStarted.then(() => value);
}

const socials = vi.hoisted(() => ({ value: [{ id: 's1' }, { id: 's2' }] }));
const levels = vi.hoisted(() => ({ value: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }));
const boats = vi.hoisted(() => ({
  value: [{ id: 'b1', active: true }, { id: 'b2', active: true }, { id: 'b3', active: false }, { id: 'b4', active: false }],
}));
const windows = vi.hoisted(() => ({
  value: [{ id: 'w1', weekday: 1 }, { id: 'w2', weekday: 1 }, { id: 'w3', weekday: 4 }],
}));

vi.mock('@/lib/club-profile', () => ({ listSocials: () => query('listSocials', socials.value) }));
vi.mock('@/lib/skill-levels', () => ({ listSkillLevels: () => query('listSkillLevels', levels.value) }));
vi.mock('@/lib/boats', () => ({ listBoats: () => query('listBoats', boats.value) }));
vi.mock('@/lib/schedule', () => ({ listWindowsWithBoats: () => query('listWindowsWithBoats', windows.value) }));

const getSchedulingSettings = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock('@/lib/scheduling-settings', () => ({ getSchedulingSettings }));

import ManageSettingsPage from './page';

async function renderPage() {
  render(await ManageSettingsPage({ params: Promise.resolve({ slug: 'bkk' }) }));
}

/** The five destination rows, in DOM order, as `[href, text]`. */
function rows(): [string, string][] {
  return screen
    .getAllByRole('link')
    .map((el) => [el.getAttribute('href') ?? '', el.textContent ?? ''] as [string, string])
    .filter(([href]) => href !== '/' && href !== '/book');
}

beforeEach(() => {
  started = [];
  timedOut = false;
  getSchedulingSettings.mockClear();
  let resolve!: () => void;
  allStarted = new Promise<void>((r) => {
    resolve = r;
  });
  timer = setTimeout(() => {
    timedOut = true;
    resolve();
  }, 50);
  release = () => {
    clearTimeout(timer);
    resolve();
  };
});

afterEach(() => {
  clearTimeout(timer);
});

describe('the manage settings index', () => {
  it('lists the five setup pages at their unchanged URLs', async () => {
    await renderPage();
    expect(rows().map(([href]) => href)).toEqual([
      '/manage/profile',
      '/manage/skill-levels',
      '/manage/boats',
      '/manage/schedule',
      '/manage/policies',
    ]);
  });

  /**
   * The summary is the whole reason this index is worth the extra click — a menu of five
   * words would be strictly worse than the nav it replaced. Each row is asserted on the
   * arguments it computed, so a row that renders its label and forgets its state fails.
   */
  it('carries the state of every row', async () => {
    await renderPage();
    const text = rows().map(([, t]) => t);
    // tagline set, description and logo not => 1 of 3; two social links.
    expect(text[0]).toContain('settings.profileSummary {"filled":1,"socials":2}');
    expect(text[1]).toContain('settings.skillLevelsSummary {"count":3}');
    // "4 boats, 2 active" — the count AND how many of them are usable.
    expect(text[2]).toContain('settings.boatsSummary {"count":4,"active":2}');
    // Three windows spread over two distinct weekdays.
    expect(text[3]).toContain('settings.scheduleSummary {"windows":3,"days":2}');
  });

  /**
   * The policies row comes off the `clubs` row `requireOwner` already returned. Nothing
   * is re-read for it, which is why it is absent from the query gate above.
   */
  it('summarises the booking policies from the club row it was handed', async () => {
    await renderPage();
    expect(rows()[4][1]).toContain(
      'settings.policiesSummary {"mode":"lead","leadDays":3,"selfCancel":"on","waitlist":5}',
    );
  });

  it('reads an unset waitlist cap as no cap rather than as a missing value', async () => {
    club.value = { ...club.value, waitlistCapacity: null as unknown as number };
    await renderPage();
    expect(rows()[4][1]).toContain('"waitlist":0');
    club.value = { ...club.value, waitlistCapacity: 5 };
  });

  /**
   * THE query test. Two independent claims:
   *
   * 1. Exactly four queries run, each once — no N+1, and no page-level duplicate of a
   *    list some row already has.
   * 2. `getSchedulingSettings` is not among them. Every column it returns is already on
   *    the `clubs` row `requireOwner` handed us, so calling it re-SELECTs data in hand.
   * 3. The four are in flight together, not awaited in a row. See the gate above.
   */
  it('runs four queries, in one Promise.all, and never re-reads the club', async () => {
    await renderPage();
    expect([...started].sort()).toEqual(['listBoats', 'listSkillLevels', 'listSocials', 'listWindowsWithBoats']);
    expect(getSchedulingSettings).not.toHaveBeenCalled();
    expect(timedOut, 'the four queries did not overlap — they were awaited one at a time').toBe(false);
  });

  /**
   * The two console exits moved here from their own row of chrome in `layout.tsx`. ONE
   * DOM node each: a `hidden` / `lg:hidden` pair would put two "Member view" links in the
   * accessibility tree, one of them invisible at any given viewport.
   */
  it('ends with the two console exits, once each', async () => {
    await renderPage();
    const exits = screen.getAllByRole('link').filter((el) => ['/', '/book'].includes(el.getAttribute('href') ?? ''));
    expect(exits.map((el) => el.getAttribute('href'))).toEqual(['/', '/book']);
    expect(exits.map((el) => el.textContent)).toEqual(['viewPublicPage', 'viewAsMember']);
  });
});
