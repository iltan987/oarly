import { describe, expect, it } from 'vitest';

import { renderBookingCancellation, renderBookingConfirmation, renderNoShowPenalty, renderWaitlistPromotion } from './index';

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
  });

  it('omits the ban rows when no ban was imposed', async () => {
    const email = await renderNoShowPenalty('en', { ...when, bannedUntil: null, cancelledCount: 0 });
    expect(email.text).not.toContain('Cannot book until');
    expect(email.text).not.toContain('Bookings cancelled');
  });

  it('renders in Turkish', async () => {
    const email = await renderNoShowPenalty('tr', { ...when, bannedUntil: new Date('2026-03-17T04:00:00Z'), cancelledCount: 1 });
    expect(email.subject).toBe('Katılmadığınız kaydedildi');
  });
});
