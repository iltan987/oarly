export type RateRule = { limit: number; windowSec: number };

// Thresholds from the spec (§17). Tune here in one place.
export const RATE_LIMITS = {
  loginPerAccount: { limit: 5, windowSec: 15 * 60 },
  loginPerIp: { limit: 20, windowSec: 60 },
  signupPerIp: { limit: 5, windowSec: 60 * 60 },
  passwordResetPerEmail: { limit: 3, windowSec: 60 * 60 },
  passwordResetPerIp: { limit: 10, windowSec: 60 * 60 },
  bookingPerAccount: { limit: 10, windowSec: 60 },
  bookingPerIp: { limit: 60, windowSec: 60 },
  apiBaselinePerIp: { limit: 100, windowSec: 60 },
} satisfies Record<string, RateRule>;
