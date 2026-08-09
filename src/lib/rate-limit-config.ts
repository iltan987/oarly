export type RateRule = { name: string; limit: number; windowSec: number };

/**
 * Thresholds from the spec (§17), which calls them "default thresholds (tunable in one
 * config)". This is that config.
 *
 * SIZING RULE, applied to every `*PerIp` entry below: a per-IP bucket is SHARED by
 * everyone behind one NAT and PRIVATE to nobody. Oarly's users are rowing clubs whose
 * members plausibly all sit on one boathouse, gym, or office egress address, so a per-IP
 * ceiling is really a per-CLUB ceiling. Meanwhile a real attacker rotates IPs for pennies,
 * so the per-IP dimension buys very little enforcement. Conclusion: per-IP limits are
 * sized to never bind on legitimate traffic — they exist to blunt a single-source flood,
 * not to be the control — and the per-ACCOUNT / per-EMAIL limits are the ones that
 * actually stop abuse, because an account is not shared by a NAT and cannot be rotated
 * without paying the sign-up cost.
 */
export const RATE_LIMITS = {
  loginPerAccount: { name: 'loginPerAccount', limit: 5, windowSec: 15 * 60 },
  // Left at §17's value, and the only *PerIp rule not raised for the shared-NAT reason
  // above — deliberately. Sign-in has no synchronized rush the way slot-open does: a club
  // does not all sign in at once, and sessions are long-lived, so 20/min per egress IP is
  // not a plausible legitimate load even for a large club. It is also enforced by
  // better-auth rather than by us (see `authRateLimitRules`), and a member who does hit it
  // now gets a "too many requests" message rather than a wrong-password one.
  loginPerIp: { name: 'loginPerIp', limit: 20, windowSec: 60 },
  // §17 said 5/hour. Raised 6x: an admin onboarding a 20-30 member club from the
  // clubhouse Wi-Fi is one IP, and at 5/hour members 6+ are locked out for an hour with
  // no way to hurry it. Signup flooding is bounded by email verification, not by this.
  signupPerIp: { name: 'signupPerIp', limit: 30, windowSec: 60 * 60 },
  // The mail-bomb control. Per-EMAIL, so a shared NAT does not aggregate it — left at
  // §17's value deliberately.
  passwordResetPerEmail: { name: 'passwordResetPerEmail', limit: 3, windowSec: 60 * 60 },
  // §17 said 10/hour. Raised 6x for the same shared-NAT reason as signupPerIp; the
  // per-email rule above is what actually bounds mail volume to any one mailbox.
  passwordResetPerIp: { name: 'passwordResetPerIp', limit: 60, windowSec: 60 * 60 },
  // The control that stops scripted seat-sniping. Per-account, so it is unaffected by a
  // shared egress IP. Left at §17's value.
  bookingPerAccount: { name: 'bookingPerAccount', limit: 10, windowSec: 60 },
  // §17 said 60/min. Raised 10x. At 60 a booking POST also paid an apiBaselinePerIp token
  // (it is not under /api, so the proxy sees it), making the shared ceiling per egress IP
  // min(60, 100) = 60 booking submits per minute FOR AN ENTIRE CLUB — a 40-member club
  // booking two outings each at slot-open sends ~80 and 20 members get refused until the
  // fixed window rolls, by which time the seats are gone. 600 keeps the ratio to
  // bookingPerAccount at 60:1, so it cannot be the binding constraint for a plausible club.
  bookingPerIp: { name: 'bookingPerIp', limit: 600, windowSec: 60 },
  // §17 said 100/min. Raised 10x so it stays above bookingPerIp — this is charged in
  // proxy.ts on EVERY non-/api POST, so it stacks on top of every named-action rule and
  // would otherwise silently become the real booking ceiling.
  apiBaselinePerIp: { name: 'apiBaselinePerIp', limit: 1000, windowSec: 60 },
  // Not in §17 — added by the rate-limiting cycle for surfaces §17 did not enumerate.
  clubRequestPerAccount: { name: 'clubRequestPerAccount', limit: 5, windowSec: 60 * 60 },
  joinRequestPerAccount: { name: 'joinRequestPerAccount', limit: 20, windowSec: 60 * 60 },
  logoUploadPerAccount: { name: 'logoUploadPerAccount', limit: 20, windowSec: 60 * 60 },
  // Amply sized: a language switch is a single deliberate click, not a synchronized rush.
  // 60/min per egress IP is set against the shared-NAT case — a club's members behind one
  // boathouse, gym, or office IP — not against a real attacker, same as every other
  // *PerIp rule above.
  localePerIp: { name: 'localePerIp', limit: 60, windowSec: 60 },
} satisfies Record<string, RateRule>;
