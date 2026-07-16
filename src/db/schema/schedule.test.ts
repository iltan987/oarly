import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { scheduleWindows, sessions, slots, windowBoats } from '@/db/schema/schedule';

describe('schedule schema', () => {
  it('windows store weekday and session length', () => {
    const cols = getTableConfig(scheduleWindows).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['weekday', 'start_time', 'end_time', 'default_session_minutes']));
  });
  it('window_boats set quantity per boat type', () => {
    const cols = getTableConfig(windowBoats).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['window_id', 'boat_type_id', 'quantity']));
  });
  it('slots carry UTC start/end and a status', () => {
    const cols = Object.fromEntries(getTableConfig(slots).columns.map((c) => [c.name, c]));
    expect(cols['start_at'].notNull).toBe(true);
    expect(cols['status']).toBeDefined();
  });
  it('sessions carry capacity and override flag', () => {
    const cols = Object.fromEntries(getTableConfig(sessions).columns.map((c) => [c.name, c]));
    expect(cols['capacity'].notNull).toBe(true);
    expect(cols['is_override']).toBeDefined();
  });
});
