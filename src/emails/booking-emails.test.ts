import { describe, expect, it } from 'vitest';

import { renderBookingCancellation, renderBookingConfirmation, renderNoShowPenalty, renderPenaltyLift, renderWaitlistPromotion } from './index';

const base = {
  clubName: 'Bebek Rowing',
  boatName: 'Quad',
  startAt: new Date('2026-07-20T05:00:00Z'),
  endAt: new Date('2026-07-20T06:00:00Z'),
  timezone: 'Europe/Istanbul',
};

describe('booking notice emails', () => {
  for (const locale of ['tr', 'en'] as const) {
    it(`confirmation (seated) renders subject/html/text with the club and boat (${locale})`, async () => {
      const out = await renderBookingConfirmation(locale, { ...base, outcome: 'seated', queuePosition: null });
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Bebek Rowing');
      expect(out.html).toContain('Quad');
      expect(out.text.length).toBeGreaterThan(0);
    });

    it(`confirmation (waitlisted) shows the queue position (${locale})`, async () => {
      const out = await renderBookingConfirmation(locale, { ...base, outcome: 'waitlisted', queuePosition: 3 });
      expect(out.html).toContain('3');
    });

    it(`promotion renders (${locale})`, async () => {
      const out = await renderWaitlistPromotion(locale, base);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Quad');
    });

    it(`cancellation renders (${locale})`, async () => {
      const out = await renderBookingCancellation(locale, base);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Bebek Rowing');
    });
  }
});

describe('renderNoShowPenalty', () => {
  const when = { clubName: 'Oarly RC', boatName: 'Quad', startAt: new Date('2026-03-10T04:00:00Z'), endAt: new Date('2026-03-10T05:00:00Z'), timezone: 'Europe/Istanbul' };

  it('states the ban end and the cancelled bookings', async () => {
    const email = await renderNoShowPenalty('en', { ...when, bannedUntil: new Date('2026-03-17T04:00:00Z'), cancelledCount: 2 });
    expect(email.subject).toBe('You were marked absent');
    expect(email.text).toContain('Cannot book until');
    expect(email.text).toContain('Bookings cancelled');
    expect(email.text).toContain('2');
    // introNoBan's reassurance ("access is unaffected") must NOT leak into the
    // banned case — the intro string chosen must match the ban, not the seat
    // count or row presence, which the assertions above don't pin down.
    expect(email.text).toContain('The club recorded that you did not attend this session.');
    expect(email.text).not.toContain('Your booking access is unaffected.');
  });

  it('omits the ban rows when no ban was imposed', async () => {
    const email = await renderNoShowPenalty('en', { ...when, bannedUntil: null, cancelledCount: 0 });
    expect(email.text).not.toContain('Cannot book until');
    expect(email.text).not.toContain('Bookings cancelled');
    // The reassurance copy is the only thing that proves the no-ban intro
    // (rather than the generic ban intro) was actually selected.
    expect(email.text).toContain('Your booking access is unaffected.');
  });

  it('renders in Turkish', async () => {
    const email = await renderNoShowPenalty('tr', { ...when, bannedUntil: new Date('2026-03-17T04:00:00Z'), cancelledCount: 1 });
    expect(email.subject).toBe('Katılmadığınız kaydedildi');
  });
});

/**
 * The other half of the penalty notice, and the copy IS the feature — so it is asserted
 * as copy, not as "a non-empty string was rendered".
 *
 * The two things it must say, and the three it must not, come from the same fact: the
 * owner may be reinstating somebody who genuinely missed sessions. Mail that apologises,
 * congratulates, or calls the original penalty a mistake puts a position in the club's
 * mouth that the club did not take — and the member has the club's earlier, formal
 * "Katılmadığınız kaydedildi" sitting in the same inbox to compare it against.
 *
 * The negatives are asserted per-word rather than as one blob because a rewrite that
 * reintroduces exactly one of them is the realistic regression, and a single combined
 * assertion would name the wrong one in its failure message.
 */
describe('renderPenaltyLift', () => {
  const data = { clubName: 'Bebek Rowing' };

  it.each(['tr', 'en'] as const)('names the club and renders both bodies (%s)', async (locale) => {
    const email = await renderPenaltyLift(locale, data);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain('Bebek Rowing');
    expect(email.text).toContain('Bebek Rowing');
  });

  it('tells a Turkish member the restriction is over and that they can book again', async () => {
    const email = await renderPenaltyLift('tr', data);
    expect(email.subject).toBe('Oarly — Rezervasyon erişiminiz yeniden açıldı');
    // "the restriction is over": the club lifted it — the same verb `restriction.contact`
    // uses to tell the member only the club can ("Bu kısıtlamayı yalnızca kulüp kaldırabilir").
    expect(email.text).toMatch(/kısıtlamayı kaldırdı/i);
    // "you can book again", which is the actionable half and the one a rewrite drops first.
    expect(email.text).toMatch(/yeniden seans ayırtabilirsiniz/i);
  });

  it('tells an English member the same two things', async () => {
    const email = await renderPenaltyLift('en', data);
    expect(email.subject).toBe('Oarly — Your booking access has reopened');
    expect(email.text).toMatch(/has lifted the restriction/i);
    expect(email.text).toMatch(/can book sessions again/i);
  });

  it.each(['tr', 'en'] as const)('does not apologise on the club\'s behalf (%s)', async (locale) => {
    const email = await renderPenaltyLift(locale, data);
    expect(email.text).not.toMatch(/özür|üzgün|apolog|sorry|regret/i);
  });

  it.each(['tr', 'en'] as const)('does not congratulate the member (%s)', async (locale) => {
    const email = await renderPenaltyLift(locale, data);
    expect(email.text).not.toMatch(/tebrik|kutlu|congratul|good news|müjde/i);
  });

  it.each(['tr', 'en'] as const)('does not call the original penalty a mistake (%s)', async (locale) => {
    const email = await renderPenaltyLift(locale, data);
    expect(email.text).not.toMatch(/hata|yanlış|yanlışlık|sehven|mistake|error|in error|incorrect/i);
  });

  // An unknown locale is not a reason to send nothing, and not a reason to send English:
  // `toLocale` defaults to the app default, which is what every other template does.
  it('falls back to Turkish for a locale the app does not have', async () => {
    const email = await renderPenaltyLift('de', data);
    expect(email.subject).toBe('Oarly — Rezervasyon erişiminiz yeniden açıldı');
  });
});
