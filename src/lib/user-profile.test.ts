import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import type { DbOrTx } from '@/db';

import { updateUserProfile, type UserProfileFields } from './user-profile';

/**
 * A real drizzle instance over a recording client, not a hand-rolled `{ update: () => … }`
 * chain. A stub chain can only report the object it was handed, so it would pass whether
 * or not `.set()` ever became SQL, and it cannot see the WHERE at all. This runs the
 * statement builder for real and captures the emitted SQL text and bound parameters — so
 * the SET list, the WHERE binding and the `$onUpdate` timestamp bump are all observable.
 *
 * No connection is opened: `query` resolves immediately with an empty result set.
 */
function recordingDb() {
  const queries: { text: string; params: unknown[] }[] = [];
  const client = {
    query: (q: { text: string }, params: unknown[]) => {
      queries.push({ text: q.text, params });
      return Promise.resolve({ rows: [], rowCount: 1 });
    },
  };
  return { db: drizzle(client as never) as unknown as DbOrTx, queries };
}

const fields: UserProfileFields = {
  firstName: 'İltan',
  lastName: 'Caner',
  phone: '5551112233',
  birthday: '1990-04-17',
  gender: 'male',
  defaultPaymentType: 'regular',
};

/** `"first_name" = $3` -> `$3` -> params[2]. */
function boundTo(text: string, params: unknown[], column: string): unknown {
  const match = new RegExp(`"${column}" = \\$(\\d+)`).exec(text);
  if (!match) throw new Error(`no assignment to "${column}" in: ${text}`);
  return params[Number(match[1]) - 1];
}

describe('updateUserProfile', () => {
  it('issues exactly one UPDATE against the user table', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', fields);

    // Asserted first: every check below reads queries[0], and an implementation that
    // built nothing would make them all vacuous rather than failing.
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/^update "user" set /);
  });

  /**
   * THE test this file exists for. `user.name` is NOT NULL and is what the header avatar
   * renders (`initials(session.name)`); it is composed at sign-up and, until this writer,
   * was never written again. Drop the rewrite in `user-profile.ts` and a member who
   * corrects their first name keeps the old initials in the header on every route.
   *
   * The composed value is asserted, not merely the presence of a `name` assignment: a
   * rewrite that wrote the old name back would be the same defect.
   */
  it('rewrites user.name from the submitted first and last name', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', { ...fields, firstName: 'Ada', lastName: 'Lovelace' });

    const { text, params } = queries[0];
    expect(boundTo(text, params, 'name')).toBe('Ada Lovelace');
  });

  /**
   * The composed name is never stored padded. The action already trims each half before
   * parsing, so in practice the `.trim()` here is defensive — its live case is a half that
   * is entirely whitespace, which the schema rejects, so this pins the belt-and-braces
   * behaviour rather than a reachable path. Measured, not assumed: interior whitespace is
   * NOT collapsed (`' Ada '` + `' Lovelace '` composes three interior spaces), and the
   * function does not claim to normalise it.
   */
  it('never stores a padded name', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', { ...fields, firstName: ' Ada ', lastName: ' Lovelace ' });

    const name = String(boundTo(queries[0].text, queries[0].params, 'name'));
    expect(name).toBe(name.trim());
    expect(name.startsWith('Ada')).toBe(true);
    expect(name.endsWith('Lovelace')).toBe(true);
  });

  it('writes all six columns with the values it was given', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', fields);

    const { text, params } = queries[0];
    expect(boundTo(text, params, 'first_name')).toBe('İltan');
    expect(boundTo(text, params, 'last_name')).toBe('Caner');
    expect(boundTo(text, params, 'phone')).toBe('5551112233');
    expect(boundTo(text, params, 'birthday')).toBe('1990-04-17');
    expect(boundTo(text, params, 'gender')).toBe('male');
    expect(boundTo(text, params, 'default_payment_type')).toBe('regular');
  });

  /**
   * `birthday` is bound as a STRING, not a `Date`. `date('birthday')` is `mode: 'string'`
   * in drizzle-pg while Better Auth declares the same field as `{ type: 'date' }`, so the
   * two shapes coexist in this codebase; binding a `Date` here would round-trip a value
   * that `<input type="date">` then renders BLANK, with no error.
   */
  it('binds birthday as a YYYY-MM-DD string', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', fields);

    const bound = boundTo(queries[0].text, queries[0].params, 'birthday');
    expect(typeof bound).toBe('string');
    expect(bound).toBe('1990-04-17');
  });

  // '' is not a value here — the action maps "not set" to NULL before calling this, so
  // that "never answered" stays distinguishable from an explicit `prefer_not_to_say`.
  it('writes NULL, not an empty string, for a cleared birthday and gender', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', { ...fields, birthday: null, gender: null });

    const { text, params } = queries[0];
    expect(boundTo(text, params, 'birthday')).toBeNull();
    expect(boundTo(text, params, 'gender')).toBeNull();
  });

  // The row is chosen by the id the CALLER passed and by nothing else.
  it('targets exactly the given user id', async () => {
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-42', fields);

    const { text, params } = queries[0];
    expect(text).toMatch(/where "user"\."id" = \$\d+$/);
    expect(boundTo(text, params, 'id')).toBe('user-42');
  });

  /**
   * `updatedAt` has `$onUpdate` and `app/account/page.tsx` keys the form on it, so the
   * post-save remount that re-seeds the uncontrolled inputs depends on this statement
   * actually bumping the column. Drizzle emits it from the column definition rather than
   * from anything this function writes, which is precisely why it is worth pinning here.
   * (Measured: it reaches the driver as an ISO string, not as a `Date`.)
   */
  it('bumps updated_at, which the page keys its form remount on', async () => {
    const before = Date.now();
    const { db, queries } = recordingDb();
    await updateUserProfile(db, 'user-1', fields);

    const bound = boundTo(queries[0].text, queries[0].params, 'updated_at');
    expect(typeof bound).toBe('string');
    expect(Date.parse(String(bound))).toBeGreaterThanOrEqual(before);
  });
});
