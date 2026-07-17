# 5A Owner Scheduling Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a club owner two configuration surfaces — a recurring weekly **Schedule** (weekday time-windows, each with a session length and the boats that run in it) and a **Policies** form (booking-open, self-cancellation, no-show penalty, MultiSport mode, holiday behavior).

**Architecture:** Pure-core logic + thin server-action adapters, exactly as Plan 4. Pure-core functions take `db: DB` first, are `clubId`-scoped on every write, return plain data or a discriminated union, and contain no `revalidate`/`redirect`. Server actions under `app/s/[slug]/manage/*` are thin: `requireOwner(slug)` → zod `safeParse` (server-authoritative) → pure-core → `revalidatePath`. **No schema and no migration** — every table (`schedule_windows`, `window_boats`) and all seven `clubs` policy columns already exist; this plan adds two logic modules, three zod schemas, two manage pages, nav + checklist wiring, and i18n.

**Tech Stack:** Next.js 16.2 (App Router, `app/` at repo root), React 19.2, TypeScript, Tailwind 4, Drizzle ORM + Postgres, next-intl (TR default + EN), zod v4, shadcn Base UI (`Field`/`Input`), Vitest.

## Global Constraints

- **Server-side validation is always authoritative.** Client/action zod is UX + type coercion; pure-core adds the cross-row checks zod cannot express (window overlap, even tiling, active/same-club boats, lead-days rule).
- **Cross-club scoping on every write.** Every mutating query filters by `clubId` (from `requireOwner`, never client input). Integration tests must assert one club cannot mutate another's rows.
- **Pure core takes `db: DB` first** (`import type { DB } from '@/db'`), returns plain data, no `revalidate`/`redirect`/`headers`.
- **Never hand-author or edit `src/components/ui/*`** (shadcn CLI-add only). Use native `<select>`/`<input type="checkbox">`/`<input type="time">` inside feature components (precedent: `manage/members/skill-level-select.tsx`, `manage/boats/boats-editor.tsx`). This plan adds no new `ui/` components.
- **No commit co-author line.** Commit messages end at the subject/body — no `Co-Authored-By`.
- **ESLint is enforced** (`pnpm lint` = `eslint --max-warnings 0`; pre-commit runs `eslint --fix`). Run `pnpm lint:fix` before committing so import-sort/type-import fixes land; a task is not done if `pnpm lint` reports anything.
- **Integration tests** use the fixed harness: `Pool` + `drizzle` + `migrate(db, { migrationsFolder: './drizzle' })` in `beforeAll`, `describe.skipIf(!process.env.TEST_DATABASE_URL)`. Run with `pnpm test:integration` (sets `TEST_DATABASE_URL` to the local test DB on :5433 and runs `--no-file-parallelism`).
- **Time semantics:** `schedule_windows.start_time`/`end_time` are Postgres `time` (wall-clock, club-local; the weekly template has no date). Postgres returns them as `"HH:MM:SS"` strings; inputs accept `"HH:MM"`. 5A stores local times only; 5B combines date + time + club timezone → UTC.
- **Weekday convention:** `weekday` is `0 = Sunday … 6 = Saturday` (matches the existing schema comment). The Schedule UI displays Monday-first by bucketing on `weekday`, independent of storage order.

## File Structure

**Create**
- `src/lib/schedule.ts` + `src/lib/schedule.integration.test.ts` — windows + window-boats CRUD, validation, `listWindowsWithBoats`.
- `src/lib/scheduling-settings.ts` + `src/lib/scheduling-settings.integration.test.ts` — `getSchedulingSettings`, `updateSchedulingSettings`.
- `app/s/[slug]/manage/schedule/{page.tsx, actions.ts, schedule-editor.tsx, window-form.tsx}`.
- `app/s/[slug]/manage/policies/{page.tsx, actions.ts, policies-form.tsx}`.

**Modify**
- `src/lib/schemas.ts` + `src/lib/schemas.test.ts` — `windowBoatSchema`, `windowSchema`, `schedulingSettingsSchema`.
- `app/s/[slug]/manage/_nav.tsx` — add **Schedule** + **Policies** entries.
- `app/s/[slug]/manage/page.tsx` — add the "schedule configured" checklist item.
- `messages/en.json`, `messages/tr.json` — new `manage.schedule.*`, `manage.policies.*`, `manage.setupSchedule` keys.

**Note:** `src/db/schema/schedule.ts` (Drizzle table defs) already exists; the new logic module is `src/lib/schedule.ts` — a different directory, no collision.

---

## Task 1: zod schemas for windows and policies

**Files:**
- Modify: `src/lib/schemas.ts`
- Test: `src/lib/schemas.test.ts`

**Interfaces:**
- Produces: `windowBoatSchema`, `windowSchema`, `schedulingSettingsSchema` (all exported zod schemas). `windowSchema` parses `{ weekday:number, startTime:"HH:MM", endTime:"HH:MM", defaultSessionMinutes:number, boats: {boatTypeId:string, quantity:number}[] }`. `schedulingSettingsSchema` parses `{ bookingOpenMode:'always'|'lead', bookingOpenLeadDays:number|null, selfCancelEnabled:boolean, cancelCutoffHours:number|null, noshowPenalty, multisportMode, openOnHolidays:boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/schemas.test.ts` (create the file if it does not exist, mirroring the existing import style — check the top of the file first). Add these cases:

```ts
import { schedulingSettingsSchema, windowBoatSchema, windowSchema } from './schemas';

describe('windowBoatSchema', () => {
  it('accepts a valid boat row and coerces quantity', () => {
    const r = windowBoatSchema.safeParse({ boatTypeId: '11111111-1111-1111-1111-111111111111', quantity: '2' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity).toBe(2);
  });
  it('rejects quantity < 1', () => {
    expect(windowBoatSchema.safeParse({ boatTypeId: '11111111-1111-1111-1111-111111111111', quantity: 0 }).success).toBe(false);
  });
  it('rejects a non-uuid boatTypeId', () => {
    expect(windowBoatSchema.safeParse({ boatTypeId: 'nope', quantity: 1 }).success).toBe(false);
  });
});

describe('windowSchema', () => {
  const boat = { boatTypeId: '11111111-1111-1111-1111-111111111111', quantity: 1 };
  it('accepts a valid window and coerces weekday/minutes', () => {
    const r = windowSchema.safeParse({ weekday: '1', startTime: '08:00', endTime: '11:00', defaultSessionMinutes: '60', boats: [boat] });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.weekday).toBe(1); expect(r.data.defaultSessionMinutes).toBe(60); }
  });
  it('rejects an out-of-range weekday', () => {
    expect(windowSchema.safeParse({ weekday: 7, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [boat] }).success).toBe(false);
  });
  it('rejects a malformed time', () => {
    expect(windowSchema.safeParse({ weekday: 1, startTime: '8am', endTime: '11:00', defaultSessionMinutes: 60, boats: [boat] }).success).toBe(false);
  });
  it('rejects an empty boats array', () => {
    expect(windowSchema.safeParse({ weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [] }).success).toBe(false);
  });
});

describe('schedulingSettingsSchema', () => {
  const base = { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false } as const;
  it('accepts always mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse(base).success).toBe(true);
  });
  it('accepts lead mode with a positive lead-days count', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: '3' }).success).toBe(true);
  });
  it('rejects lead mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: null }).success).toBe(false);
  });
});
```

If `src/lib/schemas.test.ts` already imports `describe/it/expect` at the top, reuse those imports rather than re-adding them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/lib/schemas.test.ts`
Expected: FAIL — `windowSchema`/`windowBoatSchema`/`schedulingSettingsSchema` are not exported.

- [ ] **Step 3: Add the schemas**

Append to `src/lib/schemas.ts` (the file already `import * as z from 'zod'` at the top):

```ts
// --- scheduling config (5A): server actions re-parse these; pure-core adds the
//     cross-row checks (window overlap, even tiling, same-club/active boats,
//     lead-days rule) that zod cannot express. ---
export const windowBoatSchema = z.object({
  boatTypeId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(99),
});

export const windowSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  defaultSessionMinutes: z.coerce.number().int().min(5).max(1440),
  boats: z.array(windowBoatSchema).min(1),
});

export const schedulingSettingsSchema = z
  .object({
    bookingOpenMode: z.enum(['always', 'lead']),
    bookingOpenLeadDays: z.coerce.number().int().min(1).max(365).nullable(),
    selfCancelEnabled: z.boolean(),
    cancelCutoffHours: z.coerce.number().int().min(0).max(720).nullable(),
    noshowPenalty: z.enum(['off', '2d', '1w', '2w', '1m', 'never']),
    multisportMode: z.enum(['equal', 'priority']),
    openOnHolidays: z.boolean(),
  })
  .refine((v) => v.bookingOpenMode !== 'lead' || v.bookingOpenLeadDays !== null, {
    message: 'lead mode requires lead days',
    path: ['bookingOpenLeadDays'],
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/schemas.test.ts`
Expected: PASS (all new cases green).

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint:fix && pnpm lint
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat(schedule): add zod schemas for windows and scheduling settings"
```

---

## Task 2: `schedule.ts` — windows + window-boats logic

**Files:**
- Create: `src/lib/schedule.ts`
- Test: `src/lib/schedule.integration.test.ts`

**Interfaces:**
- Consumes: `DB` from `@/db`; tables `boatTypes`, `scheduleWindows`, `windowBoats` from `@/db/schema`.
- Produces:
  - `type WindowError = 'end_before_start' | 'uneven_tiling' | 'overlap' | 'invalid_boats' | 'not_found'`
  - `type WindowResult = { ok: true; id: string } | { ok: false; error: WindowError }`
  - `interface WindowBoatInput { boatTypeId: string; quantity: number }`
  - `interface WindowInput { weekday: number; startTime: string; endTime: string; defaultSessionMinutes: number; boats: WindowBoatInput[] }`
  - `interface WindowWithBoats` = the window row plus `boats: { boatTypeId: string; boatName: string; quantity: number }[]`
  - `listWindowsWithBoats(db, clubId): Promise<WindowWithBoats[]>`
  - `createWindow(db, clubId, input: WindowInput): Promise<WindowResult>`
  - `updateWindow(db, { clubId, windowId, ...WindowInput }): Promise<WindowResult>`
  - `deleteWindow(db, { clubId, windowId }): Promise<boolean>`

- [ ] **Step 1: Write the failing integration tests**

Create `src/lib/schedule.integration.test.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { createWindow, deleteWindow, listWindowsWithBoats, updateWindow } from './schedule';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('schedule', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }
  async function newBoat(clubId: string, name: string, active = true) {
    const [b] = await db.insert(schema.boatTypes).values({ clubId, name, seats: 4, allowedPayment: 'both', active }).returning();
    return b;
  }

  it('creates a window with boats and lists it with joined boat names', async () => {
    const c = await newClub('sch-create');
    const quad = await newBoat(c.id, 'Quad');
    const dbl = await newBoat(c.id, 'Double');
    const r = await createWindow(db, c.id, { weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: quad.id, quantity: 1 }, { boatTypeId: dbl.id, quantity: 2 }] });
    expect(r.ok).toBe(true);
    const list = await listWindowsWithBoats(db, c.id);
    expect(list).toHaveLength(1);
    expect(list[0].weekday).toBe(1);
    expect(list[0].startTime.slice(0, 5)).toBe('08:00');
    expect(list[0].boats.map((b) => `${b.boatName}x${b.quantity}`).sort()).toEqual(['Doublex2', 'Quadx1']);
  });

  it('rejects an uneven tiling', async () => {
    const c = await newClub('sch-tile');
    const boat = await newBoat(c.id, 'Quad');
    const r = await createWindow(db, c.id, { weekday: 2, startTime: '08:00', endTime: '11:30', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    expect(r).toEqual({ ok: false, error: 'uneven_tiling' });
    expect(await listWindowsWithBoats(db, c.id)).toHaveLength(0);
  });

  it('rejects end before start', async () => {
    const c = await newClub('sch-order');
    const boat = await newBoat(c.id, 'Quad');
    const r = await createWindow(db, c.id, { weekday: 2, startTime: '11:00', endTime: '08:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    expect(r).toEqual({ ok: false, error: 'end_before_start' });
  });

  it('rejects an overlapping window but allows touching and other-weekday windows', async () => {
    const c = await newClub('sch-overlap');
    const boat = await newBoat(c.id, 'Quad');
    const b = { boatTypeId: boat.id, quantity: 1 };
    expect((await createWindow(db, c.id, { weekday: 3, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true);
    expect(await createWindow(db, c.id, { weekday: 3, startTime: '10:00', endTime: '12:00', defaultSessionMinutes: 60, boats: [b] })).toEqual({ ok: false, error: 'overlap' });
    expect((await createWindow(db, c.id, { weekday: 3, startTime: '11:00', endTime: '14:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true); // touching
    expect((await createWindow(db, c.id, { weekday: 4, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true); // other day
  });

  it('rejects invalid boats: empty, foreign-club, inactive, duplicate', async () => {
    const c = await newClub('sch-boats');
    const other = await newClub('sch-boats-other');
    const good = await newBoat(c.id, 'Quad');
    const inactive = await newBoat(c.id, 'Old', false);
    const foreign = await newBoat(other.id, 'Foreign');
    const mk = (boats: { boatTypeId: string; quantity: number }[]) => createWindow(db, c.id, { weekday: 5, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats });
    expect(await mk([])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: foreign.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: inactive.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: good.id, quantity: 1 }, { boatTypeId: good.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
  });

  it('update replaces the boats set and updates window fields', async () => {
    const c = await newClub('sch-update');
    const quad = await newBoat(c.id, 'Quad');
    const dbl = await newBoat(c.id, 'Double');
    const created = await createWindow(db, c.id, { weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: quad.id, quantity: 1 }] });
    if (!created.ok) throw new Error('setup failed');
    const upd = await updateWindow(db, { clubId: c.id, windowId: created.id, weekday: 1, startTime: '09:00', endTime: '11:00', defaultSessionMinutes: 120, boats: [{ boatTypeId: dbl.id, quantity: 3 }] });
    expect(upd.ok).toBe(true);
    const list = await listWindowsWithBoats(db, c.id);
    expect(list[0].startTime.slice(0, 5)).toBe('09:00');
    expect(list[0].defaultSessionMinutes).toBe(120);
    expect(list[0].boats).toEqual([{ boatTypeId: dbl.id, boatName: 'Double', quantity: 3 }]);
  });

  it('scopes update and delete to the owning club', async () => {
    const c1 = await newClub('sch-scope1');
    const c2 = await newClub('sch-scope2');
    const boat = await newBoat(c1.id, 'Quad');
    const created = await createWindow(db, c1.id, { weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    if (!created.ok) throw new Error('setup failed');
    // c2 cannot update or delete c1's window
    expect(await updateWindow(db, { clubId: c2.id, windowId: created.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] })).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteWindow(db, { clubId: c2.id, windowId: created.id })).toBe(false);
    expect(await listWindowsWithBoats(db, c1.id)).toHaveLength(1);
    // c1 can delete its own
    expect(await deleteWindow(db, { clubId: c1.id, windowId: created.id })).toBe(true);
    const [orphan] = await db.select().from(schema.windowBoats).where(eq(schema.windowBoats.windowId, created.id));
    expect(orphan).toBeUndefined(); // window_boats cascade-deleted
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration src/lib/schedule.integration.test.ts`
Expected: FAIL — module `./schedule` / its exports do not exist.

- [ ] **Step 3: Implement `src/lib/schedule.ts`**

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, scheduleWindows, windowBoats } from '@/db/schema';

export type ScheduleWindow = typeof scheduleWindows.$inferSelect;
export type WindowError = 'end_before_start' | 'uneven_tiling' | 'overlap' | 'invalid_boats' | 'not_found';
export type WindowResult = { ok: true; id: string } | { ok: false; error: WindowError };

export interface WindowBoatInput {
  boatTypeId: string;
  quantity: number;
}
export interface WindowInput {
  weekday: number;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  defaultSessionMinutes: number;
  boats: WindowBoatInput[];
}
export interface WindowWithBoats extends ScheduleWindow {
  boats: { boatTypeId: string; boatName: string; quantity: number }[];
}

/** Parse a Postgres `time` value ("HH:MM" or "HH:MM:SS") into minutes-from-midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export async function listWindowsWithBoats(db: DB, clubId: string): Promise<WindowWithBoats[]> {
  const windows = await db
    .select()
    .from(scheduleWindows)
    .where(eq(scheduleWindows.clubId, clubId))
    .orderBy(asc(scheduleWindows.weekday), asc(scheduleWindows.startTime));
  if (windows.length === 0) return [];
  const rows = await db
    .select({ windowId: windowBoats.windowId, boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, boatName: boatTypes.name })
    .from(windowBoats)
    .innerJoin(boatTypes, eq(windowBoats.boatTypeId, boatTypes.id))
    .where(inArray(windowBoats.windowId, windows.map((w) => w.id)));
  return windows.map((w) => ({
    ...w,
    boats: rows.filter((r) => r.windowId === w.id).map((r) => ({ boatTypeId: r.boatTypeId, boatName: r.boatName, quantity: r.quantity })),
  }));
}

/**
 * Validate a window against the club's other windows and boats. Reads run on the
 * outer `db` connection (owner config is not a concurrency-sensitive path), so the
 * transaction that follows only performs writes.
 */
async function validate(db: DB, clubId: string, input: WindowInput, excludeWindowId: string | null): Promise<WindowError | null> {
  const start = toMinutes(input.startTime);
  const end = toMinutes(input.endTime);
  if (end <= start) return 'end_before_start';
  if (input.defaultSessionMinutes < 5 || (end - start) % input.defaultSessionMinutes !== 0) return 'uneven_tiling';

  if (input.boats.length === 0) return 'invalid_boats';
  const ids = input.boats.map((b) => b.boatTypeId);
  if (new Set(ids).size !== ids.length) return 'invalid_boats';
  if (input.boats.some((b) => b.quantity < 1)) return 'invalid_boats';
  const active = await db.select({ id: boatTypes.id }).from(boatTypes).where(and(eq(boatTypes.clubId, clubId), eq(boatTypes.active, true)));
  const activeIds = new Set(active.map((b) => b.id));
  if (ids.some((id) => !activeIds.has(id))) return 'invalid_boats';

  const sameDay = await db.select().from(scheduleWindows).where(and(eq(scheduleWindows.clubId, clubId), eq(scheduleWindows.weekday, input.weekday)));
  for (const w of sameDay) {
    if (excludeWindowId && w.id === excludeWindowId) continue;
    // strict overlap; touching boundaries (a.end === b.start) are allowed.
    if (start < toMinutes(w.endTime) && toMinutes(w.startTime) < end) return 'overlap';
  }
  return null;
}

export async function createWindow(db: DB, clubId: string, input: WindowInput): Promise<WindowResult> {
  const err = await validate(db, clubId, input, null);
  if (err) return { ok: false, error: err };
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(scheduleWindows)
      .values({ clubId, weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, defaultSessionMinutes: input.defaultSessionMinutes })
      .returning({ id: scheduleWindows.id });
    await tx.insert(windowBoats).values(input.boats.map((b) => ({ windowId: w.id, boatTypeId: b.boatTypeId, quantity: b.quantity })));
    return { ok: true, id: w.id };
  });
}

export async function updateWindow(db: DB, input: { clubId: string; windowId: string } & WindowInput): Promise<WindowResult> {
  const [existing] = await db
    .select({ id: scheduleWindows.id })
    .from(scheduleWindows)
    .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)))
    .limit(1);
  if (!existing) return { ok: false, error: 'not_found' };
  const err = await validate(db, input.clubId, input, input.windowId);
  if (err) return { ok: false, error: err };
  return db.transaction(async (tx) => {
    await tx
      .update(scheduleWindows)
      .set({ weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, defaultSessionMinutes: input.defaultSessionMinutes })
      .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    await tx.delete(windowBoats).where(eq(windowBoats.windowId, input.windowId));
    await tx.insert(windowBoats).values(input.boats.map((b) => ({ windowId: input.windowId, boatTypeId: b.boatTypeId, quantity: b.quantity })));
    return { ok: true, id: input.windowId };
  });
}

export async function deleteWindow(db: DB, input: { clubId: string; windowId: string }): Promise<boolean> {
  const res = await db
    .delete(scheduleWindows)
    .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)))
    .returning({ id: scheduleWindows.id });
  return res.length > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:integration src/lib/schedule.integration.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint:fix && pnpm lint
git add src/lib/schedule.ts src/lib/schedule.integration.test.ts
git commit -m "feat(schedule): window + window-boats logic with overlap and tiling validation"
```

---

## Task 3: `scheduling-settings.ts` — club policy logic

**Files:**
- Create: `src/lib/scheduling-settings.ts`
- Test: `src/lib/scheduling-settings.integration.test.ts`

**Interfaces:**
- Consumes: `DB` from `@/db`; table `clubs` from `@/db/schema`.
- Produces:
  - `interface SchedulingSettingsInput { bookingOpenMode:'always'|'lead'; bookingOpenLeadDays:number|null; selfCancelEnabled:boolean; cancelCutoffHours:number|null; noshowPenalty:'off'|'2d'|'1w'|'2w'|'1m'|'never'; multisportMode:'equal'|'priority'; openOnHolidays:boolean }`
  - `type SchedulingResult = { ok: true } | { ok: false; error: 'invalid_lead' }`
  - `getSchedulingSettings(db, clubId): Promise<SchedulingSettingsInput>`
  - `updateSchedulingSettings(db, clubId, input): Promise<SchedulingResult>`

- [ ] **Step 1: Write the failing integration tests**

Create `src/lib/scheduling-settings.integration.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { getSchedulingSettings, updateSchedulingSettings } from './scheduling-settings';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('scheduling-settings', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('persists and reads back all seven fields', async () => {
    const c = await newClub('set-rw');
    const r = await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', openOnHolidays: true });
    expect(r).toEqual({ ok: true });
    expect(await getSchedulingSettings(db, c.id)).toEqual({ bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', openOnHolidays: true });
  });

  it('rejects lead mode without a valid lead-days count', async () => {
    const c = await newClub('set-lead');
    expect(await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false })).toEqual({ ok: false, error: 'invalid_lead' });
  });

  it('normalizes lead days to null under always mode', async () => {
    const c = await newClub('set-null');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: 5, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false });
    expect((await getSchedulingSettings(db, c.id)).bookingOpenLeadDays).toBeNull();
  });

  it('scopes updates to the owning club', async () => {
    const c1 = await newClub('set-scope1');
    const c2 = await newClub('set-scope2');
    await updateSchedulingSettings(db, c1.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: false, cancelCutoffHours: null, noshowPenalty: '1m', multisportMode: 'equal', openOnHolidays: false });
    // c2 is untouched — still its defaults
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c2.id));
    expect(row.noshowPenalty).toBe('off');
    expect(row.selfCancelEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration src/lib/scheduling-settings.integration.test.ts`
Expected: FAIL — module `./scheduling-settings` / its exports do not exist.

- [ ] **Step 3: Implement `src/lib/scheduling-settings.ts`**

```ts
import { eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubs } from '@/db/schema';

export interface SchedulingSettingsInput {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  openOnHolidays: boolean;
}
export type SchedulingResult = { ok: true } | { ok: false; error: 'invalid_lead' };

export async function getSchedulingSettings(db: DB, clubId: string): Promise<SchedulingSettingsInput> {
  const [c] = await db
    .select({
      bookingOpenMode: clubs.bookingOpenMode,
      bookingOpenLeadDays: clubs.bookingOpenLeadDays,
      selfCancelEnabled: clubs.selfCancelEnabled,
      cancelCutoffHours: clubs.cancelCutoffHours,
      noshowPenalty: clubs.noshowPenalty,
      multisportMode: clubs.multisportMode,
      openOnHolidays: clubs.openOnHolidays,
    })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);
  if (!c) throw new Error(`club ${clubId} not found`);
  return c;
}

export async function updateSchedulingSettings(db: DB, clubId: string, input: SchedulingSettingsInput): Promise<SchedulingResult> {
  if (input.bookingOpenMode === 'lead' && (input.bookingOpenLeadDays === null || input.bookingOpenLeadDays < 1)) {
    return { ok: false, error: 'invalid_lead' };
  }
  await db
    .update(clubs)
    .set({
      bookingOpenMode: input.bookingOpenMode,
      bookingOpenLeadDays: input.bookingOpenMode === 'lead' ? input.bookingOpenLeadDays : null,
      selfCancelEnabled: input.selfCancelEnabled,
      cancelCutoffHours: input.cancelCutoffHours,
      noshowPenalty: input.noshowPenalty,
      multisportMode: input.multisportMode,
      openOnHolidays: input.openOnHolidays,
    })
    .where(eq(clubs.id, clubId));
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:integration src/lib/scheduling-settings.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint:fix && pnpm lint
git add src/lib/scheduling-settings.ts src/lib/scheduling-settings.integration.test.ts
git commit -m "feat(schedule): club scheduling-settings read/update logic"
```

---

## Task 4: Schedule page (weekday window editor)

**Files:**
- Create: `app/s/[slug]/manage/schedule/actions.ts`
- Create: `app/s/[slug]/manage/schedule/window-form.tsx`
- Create: `app/s/[slug]/manage/schedule/schedule-editor.tsx`
- Create: `app/s/[slug]/manage/schedule/page.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `createWindow`, `updateWindow`, `deleteWindow`, `WindowError` (Task 2); `listWindowsWithBoats` (Task 2); `listBoats` (`@/lib/boats`); `requireOwner` (`@/lib/membership`); `windowSchema` (Task 1).
- Produces: `type WindowFormState = { status: 'idle' | 'ok' | 'error'; error: WindowError | null }`; server actions `saveWindowAction(slug, prev, formData)` and `deleteWindowAction(slug, formData)`.

This is a UI task with no automated unit tests (the repo does not test client components — see `manage/boats/boats-editor.tsx`); it is verified by `pnpm lint` (zero warnings) and `pnpm build` (type-check), then a manual smoke.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`, inside the existing top-level `"manage"` object, add a `"setupSchedule"` key and a `"schedule"` block:

```json
"setupSchedule": "Set your weekly schedule",
"schedule": {
  "navLabel": "Schedule",
  "title": "Weekly schedule",
  "intro": "Set the recurring time windows for each weekday and which boats run in each.",
  "addWindow": "+ Window",
  "noWindows": "No windows",
  "edit": "Edit",
  "delete": "Delete",
  "save": "Save",
  "cancel": "Cancel",
  "startTime": "Start",
  "endTime": "End",
  "sessionMinutes": "Session (min)",
  "minutesShort": "min",
  "boats": "Boats",
  "addBoat": "+ Boat",
  "removeBoat": "Remove",
  "needBoats": "Add at least one active boat type first, on the Boats page.",
  "weekdays": { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" },
  "errors": {
    "end_before_start": "End time must be after the start time.",
    "uneven_tiling": "Session length must divide the window evenly (no leftover minutes).",
    "overlap": "This window overlaps another window on the same day.",
    "invalid_boats": "Pick at least one active boat; no duplicates, quantity at least 1.",
    "not_found": "That window no longer exists.",
    "generic": "Could not save. Check the values and try again."
  }
}
```

In `messages/tr.json`, inside `"manage"`, add the Turkish equivalents:

```json
"setupSchedule": "Haftalık programı ayarla",
"schedule": {
  "navLabel": "Program",
  "title": "Haftalık program",
  "intro": "Her gün için tekrarlayan zaman aralıklarını ve her aralıkta hangi teknelerin çıkacağını ayarlayın.",
  "addWindow": "+ Aralık",
  "noWindows": "Aralık yok",
  "edit": "Düzenle",
  "delete": "Sil",
  "save": "Kaydet",
  "cancel": "İptal",
  "startTime": "Başlangıç",
  "endTime": "Bitiş",
  "sessionMinutes": "Seans (dk)",
  "minutesShort": "dk",
  "boats": "Tekneler",
  "addBoat": "+ Tekne",
  "removeBoat": "Kaldır",
  "needBoats": "Önce Tekneler sayfasından en az bir aktif tekne tipi ekleyin.",
  "weekdays": { "0": "Pazar", "1": "Pazartesi", "2": "Salı", "3": "Çarşamba", "4": "Perşembe", "5": "Cuma", "6": "Cumartesi" },
  "errors": {
    "end_before_start": "Bitiş saati başlangıçtan sonra olmalı.",
    "uneven_tiling": "Seans süresi aralığı tam bölmeli (artan dakika kalmamalı).",
    "overlap": "Bu aralık aynı gündeki başka bir aralıkla çakışıyor.",
    "invalid_boats": "En az bir aktif tekne seçin; tekrar olmasın, adet en az 1 olsun.",
    "not_found": "Bu aralık artık mevcut değil.",
    "generic": "Kaydedilemedi. Değerleri kontrol edip tekrar deneyin."
  }
}
```

Validate both files parse: `node -e "require('./messages/en.json'); require('./messages/tr.json'); console.log('ok')"` → prints `ok`.

- [ ] **Step 2: Create the server actions**

`app/s/[slug]/manage/schedule/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { createWindow, deleteWindow, updateWindow, type WindowError } from '@/lib/schedule';
import { windowSchema } from '@/lib/schemas';

export type WindowFormState = { status: 'idle' | 'ok' | 'error'; error: WindowError | null };

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/schedule`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function saveWindowAction(slug: string, _prev: WindowFormState, formData: FormData): Promise<WindowFormState> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  const boatTypeIds = formData.getAll('boatTypeId').map(String);
  const quantities = formData.getAll('quantity').map((q) => Number(q));
  const parsed = windowSchema.safeParse({
    weekday: formData.get('weekday'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    defaultSessionMinutes: formData.get('defaultSessionMinutes'),
    boats: boatTypeIds.map((boatTypeId, i) => ({ boatTypeId, quantity: quantities[i] })),
  });
  if (!parsed.success) return { status: 'error', error: null }; // shows the generic message
  const windowId = formData.get('windowId');
  const result = windowId
    ? await updateWindow(db, { clubId: club.id, windowId: String(windowId), ...parsed.data })
    : await createWindow(db, club.id, parsed.data);
  if (!result.ok) return { status: 'error', error: result.error };
  refresh(slug);
  return { status: 'ok', error: null };
}

export async function deleteWindowAction(slug: string, formData: FormData): Promise<void> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  await deleteWindow(db, { clubId: club.id, windowId: String(formData.get('windowId')) });
  refresh(slug);
}
```

- [ ] **Step 3: Create the window form**

`app/s/[slug]/manage/schedule/window-form.tsx`:

```tsx
'use client';
import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { saveWindowAction, type WindowFormState } from './actions';

type Boat = { id: string; name: string };
type BoatRow = { boatTypeId: string; quantity: number };
type WindowData = { id: string; startTime: string; endTime: string; defaultSessionMinutes: number; boats: { boatTypeId: string; quantity: number }[] };
type Labels = {
  startTime: string; endTime: string; sessionMinutes: string; boats: string; addBoat: string;
  removeBoat: string; save: string; cancel: string; errors: Record<string, string>;
};

const initial: WindowFormState = { status: 'idle', error: null };
const selectClass = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

export function WindowForm({ slug, weekday, window, boats, labels, onClose }: {
  slug: string; weekday: number; window?: WindowData; boats: Boat[]; labels: Labels; onClose: () => void;
}) {
  const [state, formAction] = useActionState(saveWindowAction.bind(null, slug), initial);
  const [rows, setRows] = useState<BoatRow[]>(
    window?.boats.map((b) => ({ boatTypeId: b.boatTypeId, quantity: b.quantity })) ?? [{ boatTypeId: boats[0].id, quantity: 1 }],
  );
  useEffect(() => { if (state.status === 'ok') onClose(); }, [state, onClose]);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border p-3">
      {window && <input type="hidden" name="windowId" value={window.id} />}
      <input type="hidden" name="weekday" value={weekday} />
      <div className="grid grid-cols-3 gap-3">
        <Field>
          <FieldLabel htmlFor="startTime">{labels.startTime}</FieldLabel>
          <Input id="startTime" name="startTime" type="time" defaultValue={window?.startTime.slice(0, 5) ?? '08:00'} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="endTime">{labels.endTime}</FieldLabel>
          <Input id="endTime" name="endTime" type="time" defaultValue={window?.endTime.slice(0, 5) ?? '11:00'} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultSessionMinutes">{labels.sessionMinutes}</FieldLabel>
          <Input id="defaultSessionMinutes" name="defaultSessionMinutes" type="number" min={5} step={5} defaultValue={window?.defaultSessionMinutes ?? 60} required />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{labels.boats}</span>
        {rows.map((row, i) => (
          <div key={i} className="flex items-end gap-2">
            <select
              name="boatTypeId"
              value={row.boatTypeId}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, boatTypeId: e.target.value } : r)))}
              className={selectClass}
            >
              {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Input
              type="number"
              name="quantity"
              min={1}
              value={row.quantity}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, quantity: Number(e.target.value) } : r)))}
              className="w-20"
            />
            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{labels.removeBoat}</Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, { boatTypeId: boats[0].id, quantity: 1 }])}>
          {labels.addBoat}
        </Button>
      </div>
      {state.status === 'error' && (
        <p className="text-sm text-destructive">{state.error ? labels.errors[state.error] : labels.errors.generic}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">{labels.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{labels.cancel}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Create the schedule editor**

`app/s/[slug]/manage/schedule/schedule-editor.tsx`:

```tsx
'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { deleteWindowAction } from './actions';
import { WindowForm } from './window-form';

type Boat = { id: string; name: string };
type WindowRow = { id: string; weekday: number; startTime: string; endTime: string; defaultSessionMinutes: number; boats: { boatTypeId: string; boatName: string; quantity: number }[] };
type Labels = {
  addWindow: string; noWindows: string; edit: string; delete: string; minutesShort: string; needBoats: string;
  startTime: string; endTime: string; sessionMinutes: string; boats: string; addBoat: string; removeBoat: string;
  save: string; cancel: string; errors: Record<string, string>;
};

// Storage weekday is 0=Sunday..6=Saturday; display Monday-first.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleEditor({ slug, windows, boats, weekdayNames, labels }: {
  slug: string; windows: WindowRow[]; boats: Boat[]; weekdayNames: Record<number, string>; labels: Labels;
}) {
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (boats.length === 0) return <p className="text-sm text-muted-foreground">{labels.needBoats}</p>;

  return (
    <div className="flex flex-col gap-5">
      {DISPLAY_ORDER.map((wd) => {
        const dayWindows = windows.filter((w) => w.weekday === wd);
        return (
          <section key={wd} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-semibold">{weekdayNames[wd]}</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => { setAddingDay(wd); setEditingId(null); }}>{labels.addWindow}</Button>
            </div>
            {dayWindows.length === 0 && addingDay !== wd && <p className="text-sm text-muted-foreground">{labels.noWindows}</p>}
            {dayWindows.length > 0 && (
              <ul className="flex flex-col gap-2">
                {dayWindows.map((w) => (
                  <li key={w.id} className="rounded-lg border p-3">
                    {editingId === w.id ? (
                      <WindowForm slug={slug} weekday={wd} window={w} boats={boats} labels={labels} onClose={() => setEditingId(null)} />
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">
                          {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)} · {w.defaultSessionMinutes} {labels.minutesShort} · {w.boats.map((b) => `${b.boatName} ×${b.quantity}`).join(', ')}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingId(w.id); setAddingDay(null); }}>{labels.edit}</Button>
                          <form action={deleteWindowAction.bind(null, slug)}>
                            <input type="hidden" name="windowId" value={w.id} />
                            <Button type="submit" size="sm" variant="ghost">{labels.delete}</Button>
                          </form>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {addingDay === wd && <WindowForm slug={slug} weekday={wd} boats={boats} labels={labels} onClose={() => setAddingDay(null)} />}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create the page**

`app/s/[slug]/manage/schedule/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listWindowsWithBoats } from '@/lib/schedule';

import { ScheduleEditor } from './schedule-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/schedule');
  const t = await getTranslations('manage.schedule');
  const [windows, boats] = await Promise.all([listWindowsWithBoats(db, club.id), listBoats(db, club.id)]);
  const activeBoats = boats.filter((b) => b.active);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <ScheduleEditor
        slug={slug}
        windows={windows.map((w) => ({ id: w.id, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime, defaultSessionMinutes: w.defaultSessionMinutes, boats: w.boats }))}
        boats={activeBoats.map((b) => ({ id: b.id, name: b.name }))}
        weekdayNames={{ 0: t('weekdays.0'), 1: t('weekdays.1'), 2: t('weekdays.2'), 3: t('weekdays.3'), 4: t('weekdays.4'), 5: t('weekdays.5'), 6: t('weekdays.6') }}
        labels={{
          addWindow: t('addWindow'), noWindows: t('noWindows'), edit: t('edit'), delete: t('delete'),
          minutesShort: t('minutesShort'), needBoats: t('needBoats'), startTime: t('startTime'), endTime: t('endTime'),
          sessionMinutes: t('sessionMinutes'), boats: t('boats'), addBoat: t('addBoat'), removeBoat: t('removeBoat'),
          save: t('save'), cancel: t('cancel'),
          errors: {
            end_before_start: t('errors.end_before_start'), uneven_tiling: t('errors.uneven_tiling'),
            overlap: t('errors.overlap'), invalid_boats: t('errors.invalid_boats'),
            not_found: t('errors.not_found'), generic: t('errors.generic'),
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify types + lint + manual smoke**

Run: `pnpm lint:fix && pnpm lint` → Expected: no errors/warnings.
Run: `pnpm build` → Expected: compiles with no type errors (the `/s/[slug]/manage/schedule` route appears in the build output).
Manual smoke (dev): on a club with ≥1 active boat, open `/manage/schedule`, add a Monday 08:00–11:00 / 60 min / Quad ×1 window → it lists; try 08:00–11:30 / 60 min → inline "divide the window evenly" error; add a touching 11:00–14:00 window → succeeds; edit and delete work.

- [ ] **Step 7: Commit**

```bash
git add app/s/[slug]/manage/schedule messages/en.json messages/tr.json
git commit -m "feat(manage): weekly schedule window editor"
```

---

## Task 5: Policies page (scheduling settings form)

**Files:**
- Create: `app/s/[slug]/manage/policies/actions.ts`
- Create: `app/s/[slug]/manage/policies/policies-form.tsx`
- Create: `app/s/[slug]/manage/policies/page.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `getSchedulingSettings`, `updateSchedulingSettings` (Task 3); `schedulingSettingsSchema` (Task 1); `requireOwner`; `club.updatedAt` (a `Date` on the club row, used to key the form for the post-save remount pattern established in `manage/profile/profile-form.tsx`).
- Produces: `type PoliciesState = { status: 'idle' | 'ok' | 'error' }`; server action `savePoliciesAction(slug, prev, formData)`.

UI task; verified by `pnpm lint` + `pnpm build` + manual smoke. The form is **keyed on `club.updatedAt`** in the page: on a successful save the clubs row's `updated_at` bumps (`$onUpdate`), `revalidatePath` re-renders, the key changes, and the form remounts with fresh defaults — the same pattern the profile form uses to avoid Base UI's "changing default value" warning on its `Input`s. On a validation failure the action returns early **without** `revalidatePath`, so `updated_at` is unchanged, the form is not remounted, and the inline error persists.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`, inside `"manage"`, add a `"policies"` block:

```json
"policies": {
  "navLabel": "Policies",
  "title": "Booking policies",
  "intro": "Control when booking opens, cancellation rules, no-show penalties, MultiSport priority, and holidays.",
  "save": "Save",
  "bookingOpen": "Booking opens",
  "bookingOpenAlways": "Always open",
  "bookingOpenLead": "A set number of days before the slot",
  "leadDays": "Lead days (when using a set number)",
  "selfCancel": "Allow members to cancel their own booking",
  "cancelCutoff": "Cancellation cutoff (hours before start; blank = no cutoff)",
  "noshow": "No-show penalty",
  "noshowOff": "Off",
  "noshow2d": "Ban 2 days",
  "noshow1w": "Ban 1 week",
  "noshow2w": "Ban 2 weeks",
  "noshow1m": "Ban 1 month",
  "noshowNever": "Permanent ban",
  "multisport": "MultiSport mode",
  "multisportEqual": "Equal — first come, first served",
  "multisportPriority": "Priority — regular bookings come first",
  "multisportHint": "In Priority mode a MultiSport booking only holds a seat if regular bookings don't fill the boat.",
  "openOnHolidays": "Run sessions on national holidays",
  "errorInvalidLead": "Enter a lead of at least 1 day, or choose \"Always open\"."
}
```

In `messages/tr.json`, inside `"manage"`, add:

```json
"policies": {
  "navLabel": "Kurallar",
  "title": "Rezervasyon kuralları",
  "intro": "Rezervasyonun ne zaman açılacağını, iptal kurallarını, gelmeme cezalarını, MultiSport önceliğini ve tatilleri yönetin.",
  "save": "Kaydet",
  "bookingOpen": "Rezervasyon açılışı",
  "bookingOpenAlways": "Her zaman açık",
  "bookingOpenLead": "Seanstan belirli gün önce",
  "leadDays": "Kaç gün önce (belirli gün seçildiğinde)",
  "selfCancel": "Üyeler kendi rezervasyonunu iptal edebilsin",
  "cancelCutoff": "İptal son süresi (başlamadan kaç saat önce; boş = sınır yok)",
  "noshow": "Gelmeme cezası",
  "noshowOff": "Kapalı",
  "noshow2d": "2 gün yasak",
  "noshow1w": "1 hafta yasak",
  "noshow2w": "2 hafta yasak",
  "noshow1m": "1 ay yasak",
  "noshowNever": "Kalıcı yasak",
  "multisport": "MultiSport modu",
  "multisportEqual": "Eşit — ilk gelen alır",
  "multisportPriority": "Öncelik — normal rezervasyonlar önce",
  "multisportHint": "Öncelik modunda MultiSport rezervasyonu, normal rezervasyonlar tekneyi doldurmazsa yer tutar.",
  "openOnHolidays": "Resmi tatillerde seans yapılsın",
  "errorInvalidLead": "En az 1 günlük süre girin ya da \"Her zaman açık\" seçin."
}
```

Validate both parse: `node -e "require('./messages/en.json'); require('./messages/tr.json'); console.log('ok')"` → `ok`.

- [ ] **Step 2: Create the server action**

`app/s/[slug]/manage/policies/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { schedulingSettingsSchema } from '@/lib/schemas';
import { updateSchedulingSettings } from '@/lib/scheduling-settings';

export type PoliciesState = { status: 'idle' | 'ok' | 'error' };

export async function savePoliciesAction(slug: string, _prev: PoliciesState, formData: FormData): Promise<PoliciesState> {
  const { club } = await requireOwner(slug, '/manage/policies');
  const leadRaw = String(formData.get('bookingOpenLeadDays') ?? '').trim();
  const cutoffRaw = String(formData.get('cancelCutoffHours') ?? '').trim();
  const parsed = schedulingSettingsSchema.safeParse({
    bookingOpenMode: formData.get('bookingOpenMode'),
    bookingOpenLeadDays: leadRaw === '' ? null : leadRaw,
    selfCancelEnabled: formData.get('selfCancelEnabled') === 'on',
    cancelCutoffHours: cutoffRaw === '' ? null : cutoffRaw,
    noshowPenalty: formData.get('noshowPenalty'),
    multisportMode: formData.get('multisportMode'),
    openOnHolidays: formData.get('openOnHolidays') === 'on',
  });
  if (!parsed.success) return { status: 'error' };
  const result = await updateSchedulingSettings(db, club.id, parsed.data);
  if (!result.ok) return { status: 'error' };
  revalidatePath(`/s/${slug}/manage/policies`);
  revalidatePath(`/s/${slug}/manage`);
  return { status: 'ok' };
}
```

- [ ] **Step 3: Create the form**

`app/s/[slug]/manage/policies/policies-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { savePoliciesAction, type PoliciesState } from './actions';

type Settings = {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  openOnHolidays: boolean;
};
type Labels = {
  save: string; bookingOpen: string; bookingOpenAlways: string; bookingOpenLead: string; leadDays: string;
  selfCancel: string; cancelCutoff: string; noshow: string; noshowOff: string; noshow2d: string; noshow1w: string;
  noshow2w: string; noshow1m: string; noshowNever: string; multisport: string; multisportEqual: string;
  multisportPriority: string; multisportHint: string; openOnHolidays: string; errorInvalidLead: string;
};

const initial: PoliciesState = { status: 'idle' };
const selectClass = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

export function PoliciesForm({ slug, settings, labels }: { slug: string; settings: Settings; labels: Labels }) {
  const [state, formAction] = useActionState(savePoliciesAction.bind(null, slug), initial);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="bookingOpenMode">{labels.bookingOpen}</FieldLabel>
        <select id="bookingOpenMode" name="bookingOpenMode" defaultValue={settings.bookingOpenMode} className={selectClass}>
          <option value="always">{labels.bookingOpenAlways}</option>
          <option value="lead">{labels.bookingOpenLead}</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="bookingOpenLeadDays">{labels.leadDays}</FieldLabel>
        <Input id="bookingOpenLeadDays" name="bookingOpenLeadDays" type="number" min={1} max={365} defaultValue={settings.bookingOpenLeadDays ?? ''} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="selfCancelEnabled" defaultChecked={settings.selfCancelEnabled} />
        {labels.selfCancel}
      </label>
      <Field>
        <FieldLabel htmlFor="cancelCutoffHours">{labels.cancelCutoff}</FieldLabel>
        <Input id="cancelCutoffHours" name="cancelCutoffHours" type="number" min={0} max={720} defaultValue={settings.cancelCutoffHours ?? ''} />
      </Field>
      <Field>
        <FieldLabel htmlFor="noshowPenalty">{labels.noshow}</FieldLabel>
        <select id="noshowPenalty" name="noshowPenalty" defaultValue={settings.noshowPenalty} className={selectClass}>
          <option value="off">{labels.noshowOff}</option>
          <option value="2d">{labels.noshow2d}</option>
          <option value="1w">{labels.noshow1w}</option>
          <option value="2w">{labels.noshow2w}</option>
          <option value="1m">{labels.noshow1m}</option>
          <option value="never">{labels.noshowNever}</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="multisportMode">{labels.multisport}</FieldLabel>
        <select id="multisportMode" name="multisportMode" defaultValue={settings.multisportMode} className={selectClass}>
          <option value="equal">{labels.multisportEqual}</option>
          <option value="priority">{labels.multisportPriority}</option>
        </select>
        <p className="text-xs text-muted-foreground">{labels.multisportHint}</p>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="openOnHolidays" defaultChecked={settings.openOnHolidays} />
        {labels.openOnHolidays}
      </label>
      {state.status === 'error' && <p className="text-sm text-destructive">{labels.errorInvalidLead}</p>}
      <Button type="submit" className="self-start">{labels.save}</Button>
    </form>
  );
}
```

- [ ] **Step 4: Create the page**

`app/s/[slug]/manage/policies/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { getSchedulingSettings } from '@/lib/scheduling-settings';

import { PoliciesForm } from './policies-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/policies');
  const t = await getTranslations('manage.policies');
  const settings = await getSchedulingSettings(db, club.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <PoliciesForm
        key={club.updatedAt.getTime()}
        slug={slug}
        settings={settings}
        labels={{
          save: t('save'), bookingOpen: t('bookingOpen'), bookingOpenAlways: t('bookingOpenAlways'),
          bookingOpenLead: t('bookingOpenLead'), leadDays: t('leadDays'), selfCancel: t('selfCancel'),
          cancelCutoff: t('cancelCutoff'), noshow: t('noshow'), noshowOff: t('noshowOff'), noshow2d: t('noshow2d'),
          noshow1w: t('noshow1w'), noshow2w: t('noshow2w'), noshow1m: t('noshow1m'), noshowNever: t('noshowNever'),
          multisport: t('multisport'), multisportEqual: t('multisportEqual'), multisportPriority: t('multisportPriority'),
          multisportHint: t('multisportHint'), openOnHolidays: t('openOnHolidays'), errorInvalidLead: t('errorInvalidLead'),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify types + lint + manual smoke**

Run: `pnpm lint:fix && pnpm lint` → no errors/warnings.
Run: `pnpm build` → compiles; `/s/[slug]/manage/policies` appears in build output.
Manual smoke: open `/manage/policies`, set "A set number of days before the slot" and leave lead days blank → Save shows the inline "at least 1 day" error; set lead days = 3 → saves and persists after refresh; toggle checkboxes and change no-show / MultiSport → values stick after refresh.

- [ ] **Step 6: Commit**

```bash
git add app/s/[slug]/manage/policies messages/en.json messages/tr.json
git commit -m "feat(manage): booking policies (scheduling settings) form"
```

---

## Task 6: Wire nav + setup checklist

**Files:**
- Modify: `app/s/[slug]/manage/_nav.tsx`
- Modify: `app/s/[slug]/manage/page.tsx`

**Interfaces:**
- Consumes: `listWindowsWithBoats` (Task 2); the `manage.schedule.navLabel`, `manage.policies.navLabel`, and `manage.setupSchedule` i18n keys (Tasks 4–5).

- [ ] **Step 1: Add the nav entries**

In `app/s/[slug]/manage/_nav.tsx`, extend the `items` array to include Schedule and Policies between Boats and Members:

```tsx
const items = [
  { href: '', key: 'overviewNav' },
  { href: '/profile', key: 'profile' },
  { href: '/skill-levels', key: 'skillLevels' },
  { href: '/boats', key: 'boats' },
  { href: '/schedule', key: 'schedule' },
  { href: '/policies', key: 'policies' },
  { href: '/members', key: 'members' },
] as const;
```

No other change is needed: the existing label logic already resolves any non-special key via `t(`${it.key}.navLabel`)`, so `schedule`/`policies` map to `manage.schedule.navLabel` / `manage.policies.navLabel`.

- [ ] **Step 2: Add the setup-checklist item**

In `app/s/[slug]/manage/page.tsx`, import the logic and add a checklist row. Change the import block and the data fetch:

```tsx
import { listWindowsWithBoats } from '@/lib/schedule';
```

```tsx
  const [levels, boats, windows] = await Promise.all([
    listSkillLevels(db, club.id),
    listBoats(db, club.id),
    listWindowsWithBoats(db, club.id),
  ]);
```

And add the item to the `checklist` array, after the Boats row:

```tsx
    { done: windows.length > 0, label: t('setupSchedule'), href: '/manage/schedule' },
```

- [ ] **Step 3: Verify types + lint + manual smoke**

Run: `pnpm lint:fix && pnpm lint` → no errors/warnings.
Run: `pnpm build` → compiles.
Manual smoke: the manage nav now shows **Schedule** and **Policies** tabs (active-highlight works when on each), and the overview checklist shows "Set your weekly schedule" — unchecked with no windows, checked (strikethrough) once a window exists.

- [ ] **Step 4: Commit**

```bash
git add app/s/[slug]/manage/_nav.tsx app/s/[slug]/manage/page.tsx
git commit -m "feat(manage): link schedule + policies in nav and setup checklist"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** windows CRUD + validation → Tasks 1–2, 4; scheduling settings → Tasks 1, 3, 5; two pages + nav + checklist → Tasks 4–6. Deferrals (generation, per-date holiday overrides, member booking) are intentionally **not** in this plan.
- **Type consistency:** `WindowError` is defined once in `src/lib/schedule.ts` (Task 2) and re-imported by the action (Task 4); its five values match the `errors.*` i18n keys exactly. `SchedulingSettingsInput` fields (Task 3) match the `schedulingSettingsSchema` output (Task 1) and the form field names (Task 5).
- **Prerequisites:** integration tests (Tasks 2–3) require the local test Postgres on `:5433` (the `test:integration` script points at it). UI tasks require a club with ≥1 active boat for a meaningful schedule smoke.
- **Pattern fidelity:** actions mirror `manage/boats/actions.ts`; the policies-form remount-on-`updatedAt` mirrors `manage/profile/profile-form.tsx`; native `<select>`/checkbox usage mirrors `boats-editor.tsx` and `skill-level-select.tsx`. No `src/components/ui/*` files are created or edited.
