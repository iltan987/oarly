import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { user, session, account, verification } from '@/db/schema/auth';

describe('auth schema', () => {
  it('user has a text primary key and profile columns', () => {
    const cfg = getTableConfig(user);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['id'].primary).toBe(true);
    expect(cols['id'].dataType).toBe('string');
    expect(cols['email'].isUnique).toBe(true);
    for (const name of ['first_name', 'last_name', 'phone', 'default_payment_type', 'is_admin']) {
      expect(cols[name]).toBeDefined();
    }
  });

  it('session/account reference the user', () => {
    expect(getTableConfig(session).foreignKeys.length).toBeGreaterThan(0);
    expect(getTableConfig(account).foreignKeys.length).toBeGreaterThan(0);
    expect(getTableConfig(verification).columns.length).toBeGreaterThan(0);
  });
});
