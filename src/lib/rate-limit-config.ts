export type RateRule = { name: string; limit: number; windowSec: number };

// Thresholds from the spec (§17). Tune here in one place.
export const RATE_LIMITS = {
  loginPerAccount: { name: 'loginPerAccount', limit: 5, windowSec: 15 * 60 },
  loginPerIp: { name: 'loginPerIp', limit: 20, windowSec: 60 },
  signupPerIp: { name: 'signupPerIp', limit: 5, windowSec: 60 * 60 },
  passwordResetPerEmail: { name: 'passwordResetPerEmail', limit: 3, windowSec: 60 * 60 },
  passwordResetPerIp: { name: 'passwordResetPerIp', limit: 10, windowSec: 60 * 60 },
  bookingPerAccount: { name: 'bookingPerAccount', limit: 10, windowSec: 60 },
  bookingPerIp: { name: 'bookingPerIp', limit: 60, windowSec: 60 },
  apiBaselinePerIp: { name: 'apiBaselinePerIp', limit: 100, windowSec: 60 },
  // Not in §17 — added by the rate-limiting cycle for surfaces §17 did not enumerate.
  clubRequestPerAccount: { name: 'clubRequestPerAccount', limit: 5, windowSec: 60 * 60 },
  joinRequestPerAccount: { name: 'joinRequestPerAccount', limit: 20, windowSec: 60 * 60 },
  logoUploadPerAccount: { name: 'logoUploadPerAccount', limit: 20, windowSec: 60 * 60 },
  localePerIp: { name: 'localePerIp', limit: 60, windowSec: 60 },
} satisfies Record<string, RateRule>;
