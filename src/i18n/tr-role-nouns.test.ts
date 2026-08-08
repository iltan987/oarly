import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Turkish must use two different nouns for two different roles.
 *
 * Turkish is the app default, and `yönetici` was doing duty for BOTH "club owner" and
 * "platform admin". `/admin/users` offered "Yöneticiliği kaldır" (revoke platform
 * admin — a security action against a person) while `/admin/clubs/[id]` offered
 * "Yöneticiliği devret" (hand a club over — a tenancy action), one nav tab apart, in
 * the same word. English draws the distinction cleanly and Turkish did not, so the
 * operator with the most power in the product was the one being told the least.
 *
 * The split: a club owner is `kulüp sahibi` / `sahiplik`; a platform admin stays
 * `yönetici`. Asserted here rather than left to review because copy is exactly the
 * kind of change that gets "tidied" back by someone who sees two words for what looks
 * like one idea.
 *
 * It reads the JSON off disk on purpose: every component test in this repo mocks
 * next-intl and asserts on key names, so none of them can see the words.
 */

type Node = string | { [k: string]: Node };

function loadAdmin(): Record<string, Node> {
  const path = fileURLToPath(new URL('../../messages/tr.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { admin: Record<string, Node> };
  return parsed.admin;
}

/** Case-insensitive, so `Yönetici` at the start of a sentence still counts. */
function mentionsAdminNoun(value: string): boolean {
  return /yönetici/i.test(value);
}
function mentionsOwnerNoun(value: string): boolean {
  // `sahi[pb]`, not `sahip`: Turkish softens the final consonant before a vowel-initial
  // suffix, so the possessive of `sahip` is `sahibi`. Matching only `sahip` would miss
  // the form the copy actually uses most.
  return /sahi[pb]/i.test(value);
}

/** Every admin-console string that is ABOUT a club owner. */
const OWNER_KEYS = [
  'ownerEmail',
  'roleOwner',
  'detailOwners',
  'detailNoOwner',
  'transferTitle',
  'transferSelect',
  'transferNoCandidates',
  'confirmTransferTitle',
  'confirmTransferBody',
  'confirmTransferCta',
  'transferred',
  'transferErrorAlreadyOwner',
] as const;

/** Every admin-console string that is ABOUT the platform-admin flag. */
const PLATFORM_ADMIN_KEYS = [
  'roleAdmin',
  'usersAdminBadge',
  'usersGrant',
  'usersRevoke',
  'usersGranted',
  'usersRevoked',
  'usersErrorSelfRevoke',
  'usersErrorLastAdmin',
  'confirmGrantTitle',
  'confirmRevokeTitle',
  'confirmGrantCta',
  'confirmRevokeCta',
] as const;

describe('Turkish admin-console role nouns', () => {
  const admin = loadAdmin();

  it('every key this test names still exists', () => {
    // Asserted first, because a key that has been RENAMED would otherwise make both
    // checks below vacuously pass — the exact "no-op mutation survives" failure mode.
    const missing = [...OWNER_KEYS, ...PLATFORM_ADMIN_KEYS].filter((k) => typeof admin[k] !== 'string');
    expect(missing).toEqual([]);
  });

  it('never calls a club owner a yönetici', () => {
    const wrong = OWNER_KEYS.filter((k) => mentionsAdminNoun(admin[k] as string));
    expect(wrong).toEqual([]);
  });

  it('names the club owner with the owner noun wherever the role is named at all', () => {
    // `transferErrorNotMember` and friends are deliberately absent from OWNER_KEYS:
    // they talk about the TARGET's membership, not about ownership.
    const silent = OWNER_KEYS.filter((k) => !mentionsOwnerNoun(admin[k] as string));
    expect(silent).toEqual([]);
  });

  it('still calls the platform admin a yönetici', () => {
    const wrong = PLATFORM_ADMIN_KEYS.filter((k) => !mentionsAdminNoun(admin[k] as string));
    expect(wrong).toEqual([]);
  });

  it('does not let the platform-admin strings borrow the owner noun', () => {
    const wrong = PLATFORM_ADMIN_KEYS.filter((k) => mentionsOwnerNoun(admin[k] as string));
    expect(wrong).toEqual([]);
  });
});
