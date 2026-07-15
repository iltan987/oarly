import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { userSocials, consents } from '@/db/schema/profile';

describe('profile schema', () => {
  it('user_socials FKs to user', () => {
    expect(getTableConfig(userSocials).foreignKeys.length).toBe(1);
  });
  it('consents records document + version + accepted_at', () => {
    const cols = getTableConfig(consents).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['user_id', 'document', 'version', 'accepted_at']));
  });
});
