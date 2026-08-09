import { describe, expect, it } from 'vitest';

import { renderClubDecision } from './index';

describe('renderClubDecision', () => {
  it('renders the approval notice with the club name and a link', async () => {
    const email = await renderClubDecision('en', {
      clubName: 'Boğaziçi Kürek',
      decision: 'approved',
      note: null,
      url: 'https://bogazici.oarly.test',
    });
    expect(email.subject).toBe('Oarly — Your club request was approved');
    expect(email.html).toContain('Boğaziçi Kürek');
    expect(email.html).toContain('https://bogazici.oarly.test');
  });

  it('renders the rejection notice and carries the note verbatim', async () => {
    const email = await renderClubDecision('en', {
      clubName: 'Spam Club',
      decision: 'rejected',
      note: 'Duplicate of an existing club',
      url: null,
    });
    expect(email.subject).toBe('Oarly — Your club request was declined');
    expect(email.text).toContain('Duplicate of an existing club');
    expect(email.html).not.toContain('Open my club');
  });

  it('falls back to Turkish for an unknown locale', async () => {
    const email = await renderClubDecision('de', { clubName: 'X', decision: 'rejected', note: 'neden', url: null });
    expect(email.subject).toBe('Oarly — Kulüp isteğin reddedildi');
  });
});
