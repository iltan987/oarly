import { describe, expect, it } from 'vitest';
import { renderResetEmail, renderVerifyEmail } from './index';

describe('renderVerifyEmail', () => {
  it('renders tr copy with the verification url', async () => {
    const url = 'https://x/verify?token=abc';
    const { subject, html, text } = await renderVerifyEmail('tr', { url });

    expect(subject).toBe('Oarly — E-postanızı doğrulayın');
    expect(html).toContain(url);
    expect(html).toContain('E-postanızı doğrulayın');
    expect(text).toContain(url);
  });

  it('renders en copy with the verification url', async () => {
    const url = 'https://x/verify?token=abc';
    const { subject, html, text } = await renderVerifyEmail('en', { url });

    expect(subject).toBe('Oarly — Verify your email');
    expect(html).toContain(url);
    expect(html).toContain('Verify your email');
    expect(text).toContain(url);
  });
});

describe('renderResetEmail', () => {
  it('renders tr copy with the reset url', async () => {
    const url = 'https://x/reset?token=xyz';
    const { subject, html, text } = await renderResetEmail('tr', { url });

    expect(subject).toBe('Oarly — Şifrenizi sıfırlayın');
    expect(html).toContain(url);
    expect(html).toContain('Şifrenizi sıfırlayın');
    expect(text).toContain(url);
  });
});
