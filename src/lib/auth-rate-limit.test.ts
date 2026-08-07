import { describe, expect, it } from 'vitest';

import { authRateLimitRules } from '@/lib/auth-rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';

describe('authRateLimitRules', () => {
  it('covers exactly the auth endpoints this app calls', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual([
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/sign-in/email',
      '/sign-up/email',
    ]);
  });

  it('derives every threshold from RATE_LIMITS rather than hardcoding it', () => {
    expect(authRateLimitRules['/sign-in/email']).toEqual({
      window: RATE_LIMITS.loginPerIp.windowSec,
      max: RATE_LIMITS.loginPerIp.limit,
    });
    expect(authRateLimitRules['/sign-up/email']).toEqual({
      window: RATE_LIMITS.signupPerIp.windowSec,
      max: RATE_LIMITS.signupPerIp.limit,
    });
    expect(authRateLimitRules['/request-password-reset']).toEqual({
      window: RATE_LIMITS.passwordResetPerIp.windowSec,
      max: RATE_LIMITS.passwordResetPerIp.limit,
    });
  });

  it('uses the §17 values', () => {
    expect(authRateLimitRules['/sign-up/email']).toEqual({ window: 3600, max: 5 });
    expect(authRateLimitRules['/sign-in/email']).toEqual({ window: 60, max: 20 });
  });
});
