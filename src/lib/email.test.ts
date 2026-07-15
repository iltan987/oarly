import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(function() { return { emails: { send: sendMock } }; }),
}));

describe('sendEmail', () => {
  beforeEach(() => { sendMock.mockReset(); });

  it('logs instead of sending when no API key is configured', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({ env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined } }));
    const { sendEmail } = await import('@/lib/email');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({ to: 'x@y.co', subject: 'Hi', text: 'body' });
    expect(spy).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('calls Resend when a key is configured', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({ env: { RESEND_API_KEY: 'key', EMAIL_FROM: 'Oarly <no-reply@oarly.sbs>' } }));
    const { sendEmail } = await import('@/lib/email');
    await sendEmail({ to: 'x@y.co', subject: 'Hi', text: 'body' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Oarly <no-reply@oarly.sbs>', to: 'x@y.co', subject: 'Hi',
    }));
  });
});
