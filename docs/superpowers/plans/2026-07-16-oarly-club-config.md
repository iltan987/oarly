# Club Profile, Boats & Skill Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a club owner the configuration surface for their club's public profile (incl. logo), club-defined ordered skill levels, and boat types with per-boat eligibility.

**Architecture:** Pure-core + thin-adapter, exactly as Plan 3. Server actions under `app/s/[slug]/manage/*` are thin: `requireOwner(slug)` → zod parse (server-authoritative) → call a `db`-first pure-core logic function (integration-tested vs real Postgres, every write scoped by `clubId`) → `revalidatePath`. The DB schema already exists (`boat_types`, `skill_levels`, `club_socials`, most `clubs` columns) — this plan adds logic modules, UI, one additive migration (two profile columns), zod schemas, a Vercel Blob client-upload route, and a manage nav + setup checklist.

**Tech Stack:** Next.js 16 (App Router, `app/` at repo root), React 19, TypeScript, Tailwind 4, Drizzle ORM + Postgres, next-intl (TR default + EN), zod v4, react-hook-form + `@hookform/resolvers/zod`, shadcn Base UI (`Field` family), `@vercel/blob` (new), Vitest.

## Global Constraints

- **Server-side validation is always authoritative.** Client zod (RHF) is UX only; every server action re-parses with the same zod schema, and pure-core adds cross-club FK checks zod can't express.
- **Cross-club scoping on every write.** Every mutating query filters by `clubId` (from `requireOwner`, never from client input) so one club can never mutate another's rows. Integration tests must assert this for each logic function.
- **Pure core takes `db: DB` first** (`import type { DB } from '@/db'`), returns plain data, no `revalidate`/`redirect`/`headers` — those live only in the server-action adapter.
- **Never hand-author or edit `src/components/ui/*`** (shadcn CLI-add only). Use native `<select>`/`<textarea>`/radio inputs inside feature components (precedent: `manage/members/skill-level-select.tsx` uses a native `<select>`). This plan adds no new `ui/` components.
- **No commit co-author line.** Commit messages end at the subject/body — no `Co-Authored-By`.
- **ESLint is enforced** (`pnpm lint` = `eslint --max-warnings 0`; pre-commit runs `eslint --fix`). Run `pnpm lint:fix` before committing so import-sort/type-import fixes land; a task is not done if `pnpm lint` reports anything.
- **Integration tests** use the fixed harness: `Pool` + `drizzle` + `migrate(db, { migrationsFolder: './drizzle' })` in `beforeAll`, `describe.skipIf(!process.env.TEST_DATABASE_URL)`. Run with `pnpm test:integration`.
- **Skill-level rank invariant:** ranks are per-club, unique via `skill_levels_club_rank_uq` on `(club_id, rank)`, `>= 1`, assigned by append (`max(rank)+1`). Reorder must never violate the unique index mid-transaction.

## File Structure

**Create**
- `src/lib/skill-levels.ts` + `src/lib/skill-levels.integration.test.ts` — skill-level CRUD + reorder
- `src/lib/boats.ts` + `src/lib/boats.integration.test.ts` — boat-type CRUD
- `src/lib/club-profile.ts` + `src/lib/club-profile.integration.test.ts` — profile update, socials, logo, owner-check for upload
- `app/s/[slug]/manage/page.tsx` — setup checklist (manage index)
- `app/s/[slug]/manage/_nav.tsx` — shared manage nav (client, active-link)
- `app/s/[slug]/manage/skill-levels/{page.tsx,actions.ts,skill-levels-editor.tsx}`
- `app/s/[slug]/manage/boats/{page.tsx,actions.ts,boats-editor.tsx}`
- `app/s/[slug]/manage/profile/{page.tsx,actions.ts,profile-form.tsx,logo-upload.tsx}`
- `app/api/club-logo/upload/route.ts` — Blob client-upload token handler

**Modify**
- `src/db/schema/clubs.ts` — add `tagline`, `description` columns
- `src/db/schema/clubs.test.ts` — assert the two new columns
- `drizzle/0002_*.sql` — generated migration (do not hand-write)
- `src/lib/schemas.ts` — `clubProfileSchema`, `skillLevelNameSchema`, `socialSchema`, `boatSchema`
- `src/lib/schemas.test.ts` — unit tests for the new schemas
- `src/lib/members-admin.ts` + `src/lib/members-admin.integration.test.ts` — gate `assignSkillLevel` on approved membership (Plan 3 carry-forward)
- `src/lib/seo.ts` + `src/lib/seo.test.ts` — OG description from tagline/description
- `app/s/[slug]/page.tsx` — feed club description/tagline into metadata
- `app/s/[slug]/manage/layout.tsx` — render `_nav`
- `src/env.ts` — add `BLOB_READ_WRITE_TOKEN` to the server schema
- `package.json` — add `@vercel/blob`
- `messages/en.json`, `messages/tr.json` — new `manage.*` keys

---

## Task 1: Profile columns migration + schema

**Files:**
- Modify: `src/db/schema/clubs.ts`
- Modify: `src/db/schema/clubs.test.ts`
- Create: `drizzle/0002_*.sql` (generated)

**Interfaces:**
- Produces: `clubs.tagline` (`text`, nullable), `clubs.description` (`text`, nullable). `Club` (`typeof clubs.$inferSelect`) and `getClubBySlug` (which `select()`s all columns) automatically surface them.

- [ ] **Step 1: Add a failing schema assertion**

In `src/db/schema/clubs.test.ts`, extend the first test's column loop:

```typescript
for (const name of ['multisport_mode', 'booking_open_mode', 'noshow_penalty', 'brand_accent', 'timezone', 'tagline', 'description']) {
  expect(cols[name]).toBeDefined();
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/db/schema/clubs.test.ts`
Expected: FAIL — `cols['tagline']` is undefined.

- [ ] **Step 3: Add the columns to the schema**

In `src/db/schema/clubs.ts`, inside the `clubs` table definition, add after `logoUrl`:

```typescript
  logoUrl: text('logo_url'),
  tagline: text('tagline'),
  description: text('description'),
```

- [ ] **Step 4: Run the schema test — it passes**

Run: `pnpm vitest run src/db/schema/clubs.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0002_*.sql` adding `tagline` and `description` to `clubs` (`ALTER TABLE "clubs" ADD COLUMN ...`). Do not edit it by hand. Confirm it contains both columns.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/clubs.ts src/db/schema/clubs.test.ts drizzle/
git commit -m "feat(clubs): add tagline and description profile columns"
```

---

## Task 2: Zod schemas for club config

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/schemas.test.ts`

**Interfaces:**
- Produces: `clubProfileSchema`, `skillLevelNameSchema`, `socialSchema`, `boatSchema` (all zod v4). Consumed by Tasks 5, 7, 10 (client RHF + server re-parse).

- [ ] **Step 1: Write failing unit tests**

Append to `src/lib/schemas.test.ts`:

```typescript
import { boatSchema, clubProfileSchema, skillLevelNameSchema, socialSchema } from './schemas';

describe('clubProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(clubProfileSchema.safeParse({ name: 'Bebek', brandAccent: '#0E9E93', headingFont: 'default' }).success).toBe(true);
  });
  it('rejects a bad hex accent', () => {
    expect(clubProfileSchema.safeParse({ name: 'Bebek', brandAccent: 'teal' }).success).toBe(false);
  });
  it('rejects a too-short name', () => {
    expect(clubProfileSchema.safeParse({ name: 'B' }).success).toBe(false);
  });
});

describe('skillLevelNameSchema', () => {
  it('accepts a name, rejects empty', () => {
    expect(skillLevelNameSchema.safeParse({ name: 'Başlangıç' }).success).toBe(true);
    expect(skillLevelNameSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('socialSchema', () => {
  it('requires platform and handle', () => {
    expect(socialSchema.safeParse({ platform: 'instagram', handle: 'bebekrowing' }).success).toBe(true);
    expect(socialSchema.safeParse({ platform: '', handle: 'x' }).success).toBe(false);
  });
});

describe('boatSchema', () => {
  it('accepts a valid boat', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 4, allowedPayment: 'both' }).success).toBe(true);
  });
  it('rejects seats < 1', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 0, allowedPayment: 'both' }).success).toBe(false);
  });
  it('rejects minAttendance greater than seats', () => {
    expect(boatSchema.safeParse({ name: 'Double', seats: 2, allowedPayment: 'both', minAttendance: 3 }).success).toBe(false);
  });
  it('rejects a non-uuid minSkillLevelId', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 4, allowedPayment: 'both', minSkillLevelId: 'nope' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm vitest run src/lib/schemas.test.ts`
Expected: FAIL — the four schemas are not exported.

- [ ] **Step 3: Add the schemas**

Append to `src/lib/schemas.ts`:

```typescript
// --- club config (Plan 4): server actions re-parse these; pure-core adds the
//     cross-club FK checks the schema cannot express (e.g. skill level belongs
//     to the same club). ---
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'invalid hex');

export const clubProfileSchema = z.object({
  name: z.string().min(2).max(80),
  tagline: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
  brandAccent: hexColor.optional(),
  headingFont: z.enum(['default', 'premium']).default('default'),
  logoUrl: z.union([z.url(), z.literal('')]).optional(),
});

export const skillLevelNameSchema = z.object({ name: z.string().min(1).max(40) });

export const socialSchema = z.object({
  platform: z.string().min(1).max(40),
  handle: z.string().min(1).max(80),
});

export const boatSchema = z
  .object({
    name: z.string().min(1).max(60),
    seats: z.coerce.number().int().min(1).max(16),
    minSkillLevelId: z.uuid().nullable().default(null),
    allowedPayment: z.enum(['regular_only', 'multisport_only', 'both']),
    minAttendance: z.coerce.number().int().min(1).nullable().default(null),
  })
  .refine((v) => v.minAttendance === null || v.minAttendance <= v.seats, {
    message: 'min_attendance must be <= seats',
    path: ['minAttendance'],
  });
```

- [ ] **Step 4: Run — verify pass, then lint**

Run: `pnpm vitest run src/lib/schemas.test.ts` → PASS
Run: `pnpm lint:fix && pnpm lint` → 0 problems

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat(schemas): add club profile, skill-level, social, boat schemas"
```

---

## Task 3: Skill-levels logic core

**Files:**
- Create: `src/lib/skill-levels.ts`
- Test: `src/lib/skill-levels.integration.test.ts`

**Interfaces:**
- Consumes: `DB` from `@/db`; `skillLevels`, `boatTypes`, `memberships` from `@/db/schema`.
- Produces:
  - `listSkillLevels(db, clubId): Promise<SkillLevel[]>` (ordered by rank asc)
  - `createSkillLevel(db, { clubId, name }): Promise<SkillLevel>` (appends `max(rank)+1`)
  - `renameSkillLevel(db, { clubId, skillLevelId, name }): Promise<boolean>`
  - `reorderSkillLevel(db, { clubId, skillLevelId, direction: 'up'|'down' }): Promise<boolean>`
  - `countSkillLevelRefs(db, { clubId, skillLevelId }): Promise<{ members: number; boats: number }>`
  - `deleteSkillLevel(db, { clubId, skillLevelId }): Promise<boolean>`
  - `type SkillLevel = typeof skillLevels.$inferSelect`

- [ ] **Step 1: Write failing integration tests**

Create `src/lib/skill-levels.integration.test.ts`:

```typescript
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { countSkillLevelRefs, createSkillLevel, deleteSkillLevel, listSkillLevels, renameSkillLevel, reorderSkillLevel } from './skill-levels';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('skill-levels', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates levels appending rank, lists them ordered', async () => {
    const c = await newClub('sl-create');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'Novice' });
    const b = await createSkillLevel(db, { clubId: c.id, name: 'Intermediate' });
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    const list = await listSkillLevels(db, c.id);
    expect(list.map((l) => l.name)).toEqual(['Novice', 'Intermediate']);
  });

  it('renames only within the same club', async () => {
    const c1 = await newClub('sl-ren1');
    const c2 = await newClub('sl-ren2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'X' });
    expect(await renameSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, name: 'Hacked' })).toBe(false);
    expect(await renameSkillLevel(db, { clubId: c1.id, skillLevelId: lvl.id, name: 'Y' })).toBe(true);
    const [after] = await listSkillLevels(db, c1.id);
    expect(after.name).toBe('Y');
  });

  it('reorders adjacent levels without violating the unique (club, rank) index', async () => {
    const c = await newClub('sl-order');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'A' }); // rank 1
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B' }); // rank 2
    const cc = await createSkillLevel(db, { clubId: c.id, name: 'C' }); // rank 3
    // move B up → order A? no: B up swaps with A → B,A,C
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up' })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'A', 'C']);
    // move A down → swaps with C? no, A is at rank 2 now, down swaps with C(3) → B,C,A
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: a.id, direction: 'down' })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'C', 'A']);
    // moving the top-most up is a no-op returning false
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up' })).toBe(false);
    // ranks are still the contiguous 1..3 with no duplicates
    const ranks = (await listSkillLevels(db, c.id)).map((l) => l.rank);
    expect(ranks).toEqual([1, 2, 3]);
    void cc;
  });

  it('counts references then deletes, nulling out referencing members and boats', async () => {
    const c = await newClub('sl-del');
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Adv' });
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c.id, role: 'member', status: 'approved', skillLevelId: lvl.id }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: c.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id }).returning();
    expect(await countSkillLevelRefs(db, { clubId: c.id, skillLevelId: lvl.id })).toEqual({ members: 1, boats: 1 });
    expect(await deleteSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id })).toBe(true);
    const [afterM] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    const [afterB] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, boat.id));
    expect(afterM.skillLevelId).toBeNull();
    expect(afterB.minSkillLevelId).toBeNull();
  });

  it('does not delete a level belonging to another club', async () => {
    const c1 = await newClub('sl-x1');
    const c2 = await newClub('sl-x2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Z' });
    expect(await deleteSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id })).toBe(false);
    expect(await listSkillLevels(db, c1.id)).toHaveLength(1);
    void and;
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test:integration src/lib/skill-levels.integration.test.ts`
Expected: FAIL — module `./skill-levels` not found.

- [ ] **Step 3: Implement the logic**

Create `src/lib/skill-levels.ts`:

```typescript
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, memberships, skillLevels } from '@/db/schema';

export type SkillLevel = typeof skillLevels.$inferSelect;

export function listSkillLevels(db: DB, clubId: string): Promise<SkillLevel[]> {
  return db.select().from(skillLevels).where(eq(skillLevels.clubId, clubId)).orderBy(asc(skillLevels.rank));
}

export async function createSkillLevel(db: DB, input: { clubId: string; name: string }): Promise<SkillLevel> {
  const [agg] = await db.select({ maxRank: sql<number | null>`max(${skillLevels.rank})` }).from(skillLevels).where(eq(skillLevels.clubId, input.clubId));
  const nextRank = (agg?.maxRank ?? 0) + 1;
  const [row] = await db.insert(skillLevels).values({ clubId: input.clubId, name: input.name, rank: nextRank }).returning();
  return row;
}

export async function renameSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; name: string }): Promise<boolean> {
  const res = await db.update(skillLevels).set({ name: input.name })
    .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
    .returning({ id: skillLevels.id });
  return res.length > 0;
}

// Swap a level with its rank-neighbor. The unique index on (club_id, rank) is
// checked immediately (not deferrable), so we cannot set two rows to overlapping
// ranks mid-transaction. We park the moving row at a collision-free sentinel
// (-cur.rank; ranks are >= 1 and unique per club, so distinct rows map to
// distinct sentinels, and the row is locked for the duration of the tx).
export async function reorderSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; direction: 'up' | 'down' }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!cur) return false;
    const [neighbor] = input.direction === 'up'
      ? await tx.select().from(skillLevels)
          .where(and(eq(skillLevels.clubId, input.clubId), lt(skillLevels.rank, cur.rank)))
          .orderBy(desc(skillLevels.rank)).limit(1)
      : await tx.select().from(skillLevels)
          .where(and(eq(skillLevels.clubId, input.clubId), gt(skillLevels.rank, cur.rank)))
          .orderBy(asc(skillLevels.rank)).limit(1);
    if (!neighbor) return false;
    await tx.update(skillLevels).set({ rank: -cur.rank }).where(eq(skillLevels.id, cur.id));
    await tx.update(skillLevels).set({ rank: cur.rank }).where(eq(skillLevels.id, neighbor.id));
    await tx.update(skillLevels).set({ rank: neighbor.rank }).where(eq(skillLevels.id, cur.id));
    return true;
  });
}

export async function countSkillLevelRefs(db: DB, input: { clubId: string; skillLevelId: string }): Promise<{ members: number; boats: number }> {
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships)
    .where(and(eq(memberships.clubId, input.clubId), eq(memberships.skillLevelId, input.skillLevelId)));
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(boatTypes)
    .where(and(eq(boatTypes.clubId, input.clubId), eq(boatTypes.minSkillLevelId, input.skillLevelId)));
  return { members: m?.n ?? 0, boats: b?.n ?? 0 };
}

export async function deleteSkillLevel(db: DB, input: { clubId: string; skillLevelId: string }): Promise<boolean> {
  const res = await db.delete(skillLevels)
    .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
    .returning({ id: skillLevels.id });
  return res.length > 0;
}
```

- [ ] **Step 4: Run — verify pass, then lint**

Run: `pnpm test:integration src/lib/skill-levels.integration.test.ts` → all PASS
Run: `pnpm lint:fix && pnpm lint` → 0 problems (fix the throwaway `void and;`/`void cc;` guards if the reviewer flags them — they exist only to satisfy unused checks; remove them and the corresponding unused imports instead if cleaner)

- [ ] **Step 5: Commit**

```bash
git add src/lib/skill-levels.ts src/lib/skill-levels.integration.test.ts
git commit -m "feat(skill-levels): add club-scoped CRUD and rank-swap reorder"
```

---

## Task 4: Gate assignSkillLevel on approved membership (carry-forward)

**Files:**
- Modify: `src/lib/members-admin.ts`
- Modify: `src/lib/members-admin.integration.test.ts`

**Interfaces:**
- `assignSkillLevel(db, { membershipId, clubId, skillLevelId })` keeps its signature; it now additionally returns `false` (no write) when the target membership is not `approved`.

- [ ] **Step 1: Add a failing test**

Append to `src/lib/members-admin.integration.test.ts` (inside the existing `describe`):

```typescript
  it('does not assign a skill level to a non-approved membership', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1p-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();
    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvl.id })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.skillLevelId).toBeNull();
  });
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test:integration src/lib/members-admin.integration.test.ts`
Expected: FAIL — a pending membership currently gets the level assigned.

- [ ] **Step 3: Add the status gate**

In `src/lib/members-admin.ts`, change the `assignSkillLevel` update to also require `status = 'approved'`:

```typescript
  const res = await db.update(memberships)
    .set({ skillLevelId: input.skillLevelId })
    .where(and(
      eq(memberships.id, input.membershipId),
      eq(memberships.clubId, input.clubId),
      eq(memberships.status, 'approved'),
    ))
    .returning({ id: memberships.id });
  return res.length > 0;
```

(`memberships` is already imported; `and`/`eq` are already imported.)

- [ ] **Step 4: Run — verify pass**

Run: `pnpm test:integration src/lib/members-admin.integration.test.ts`
Expected: all PASS (including the pre-existing scoping tests, which use `approved` memberships).

- [ ] **Step 5: Commit**

```bash
git add src/lib/members-admin.ts src/lib/members-admin.integration.test.ts
git commit -m "fix(members): only assign skill level to approved memberships"
```

---

## Task 5: Skill-levels editor UI

**Files:**
- Create: `app/s/[slug]/manage/skill-levels/page.tsx`
- Create: `app/s/[slug]/manage/skill-levels/actions.ts`
- Create: `app/s/[slug]/manage/skill-levels/skill-levels-editor.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `requireOwner` (`@/lib/membership`), the Task 3 logic, `skillLevelNameSchema` (Task 2).

- [ ] **Step 1: Add i18n keys**

Add a `manage.skillLevels` group to both message files. `messages/en.json`:

```json
"skillLevels": {
  "navLabel": "Skill levels",
  "title": "Skill levels",
  "intro": "Define your club's ordered levels. Members are assigned a level; boats can require a minimum level.",
  "addPlaceholder": "New level name",
  "add": "Add level",
  "moveUp": "Move up",
  "moveDown": "Move down",
  "rename": "Rename",
  "save": "Save",
  "cancel": "Cancel",
  "delete": "Delete",
  "deleteConfirm": "Delete this level? {members} member(s) and {boats} boat(s) reference it and will be reset to no level.",
  "deleteConfirmYes": "Delete",
  "empty": "No skill levels yet."
}
```

`messages/tr.json` (same keys, Turkish): `navLabel`/`title` "Seviyeler", `intro` "Kulübünüzün sıralı seviyelerini tanımlayın. Üyelere seviye atanır; tekneler asgari seviye gerektirebilir.", `addPlaceholder` "Yeni seviye adı", `add` "Seviye ekle", `moveUp` "Yukarı taşı", `moveDown` "Aşağı taşı", `rename` "Yeniden adlandır", `save` "Kaydet", `cancel` "İptal", `delete` "Sil", `deleteConfirm` "Bu seviye silinsin mi? {members} üye ve {boats} tekne bu seviyeye bağlı ve seviyesiz olarak sıfırlanacak.", `deleteConfirmYes` "Sil", `empty` "Henüz seviye yok."

- [ ] **Step 2: Write the server actions**

Create `app/s/[slug]/manage/skill-levels/actions.ts`:

```typescript
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { skillLevelNameSchema } from '@/lib/schemas';
import { createSkillLevel, deleteSkillLevel, renameSkillLevel, reorderSkillLevel } from '@/lib/skill-levels';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/skill-levels`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function addSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return;
  await createSkillLevel(db, { clubId: club.id, name: parsed.data.name });
  refresh(slug);
}

export async function renameSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return;
  await renameSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), name: parsed.data.name });
  refresh(slug);
}

export async function reorderSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  await reorderSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), direction });
  refresh(slug);
}

export async function deleteSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  await deleteSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')) });
  refresh(slug);
}
```

- [ ] **Step 3: Write the page (server component)**

Create `app/s/[slug]/manage/skill-levels/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { countSkillLevelRefs, listSkillLevels } from '@/lib/skill-levels';

import { SkillLevelsEditor } from './skill-levels-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SkillLevelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const t = await getTranslations('manage.skillLevels');
  const levels = await listSkillLevels(db, club.id);
  const refs = Object.fromEntries(
    await Promise.all(levels.map(async (l) => [l.id, await countSkillLevelRefs(db, { clubId: club.id, skillLevelId: l.id })] as const)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <SkillLevelsEditor
        slug={slug}
        levels={levels.map((l) => ({ id: l.id, name: l.name, refs: refs[l.id] }))}
        labels={{
          addPlaceholder: t('addPlaceholder'), add: t('add'), moveUp: t('moveUp'), moveDown: t('moveDown'),
          rename: t('rename'), save: t('save'), cancel: t('cancel'), delete: t('delete'),
          deleteConfirmYes: t('deleteConfirmYes'), empty: t('empty'),
        }}
        deleteConfirmTemplate={{ members: t('deleteConfirm', { members: '{m}', boats: '{b}' }) }}
      />
    </div>
  );
}
```

Note: pass the raw ICU template safely — simplest is to have the editor build the confirm string from a function. To avoid ICU-in-client complexity, instead pass the already-formatted confirm strings per level. Replace the `deleteConfirmTemplate` prop with a precomputed map:

```tsx
        confirms={Object.fromEntries(levels.map((l) => [l.id, t('deleteConfirm', { members: refs[l.id].members, boats: refs[l.id].boats })]))}
```

and drop `deleteConfirmTemplate`. Use `confirms[level.id]` in the editor.

- [ ] **Step 4: Write the editor (client component)**

Create `app/s/[slug]/manage/skill-levels/skill-levels-editor.tsx`:

```tsx
'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { addSkillLevelAction, deleteSkillLevelAction, renameSkillLevelAction, reorderSkillLevelAction } from './actions';

type Level = { id: string; name: string; refs: { members: number; boats: number } };
type Labels = {
  addPlaceholder: string; add: string; moveUp: string; moveDown: string;
  rename: string; save: string; cancel: string; delete: string; deleteConfirmYes: string; empty: string;
};

export function SkillLevelsEditor({ slug, levels, labels, confirms }: {
  slug: string; levels: Level[]; labels: Labels; confirms: Record<string, string>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="divide-y rounded-lg border">
          {levels.map((lvl, i) => (
            <li key={lvl.id} className="flex items-center justify-between gap-2 p-3">
              {editing === lvl.id ? (
                <form action={renameSkillLevelAction.bind(null, slug)} className="flex flex-1 items-center gap-2" onSubmit={() => setEditing(null)}>
                  <input type="hidden" name="skillLevelId" value={lvl.id} />
                  <Field className="flex-1">
                    <FieldLabel htmlFor={`name-${lvl.id}`} className="sr-only">{labels.rename}</FieldLabel>
                    <Input id={`name-${lvl.id}`} name="name" defaultValue={lvl.name} autoFocus />
                  </Field>
                  <Button type="submit" size="sm">{labels.save}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{labels.cancel}</Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 font-medium">{lvl.name}</span>
                  <div className="flex items-center gap-1">
                    <ArrowForm slug={slug} id={lvl.id} direction="up" disabled={i === 0} label={labels.moveUp}>↑</ArrowForm>
                    <ArrowForm slug={slug} id={lvl.id} direction="down" disabled={i === levels.length - 1} label={labels.moveDown}>↓</ArrowForm>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(lvl.id)}>{labels.rename}</Button>
                    {confirming === lvl.id ? (
                      <form action={deleteSkillLevelAction.bind(null, slug)} className="flex items-center gap-1" onSubmit={() => setConfirming(null)}>
                        <input type="hidden" name="skillLevelId" value={lvl.id} />
                        <span className="max-w-xs text-xs text-muted-foreground">{confirms[lvl.id]}</span>
                        <Button type="submit" size="sm" variant="destructive">{labels.deleteConfirmYes}</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>{labels.cancel}</Button>
                      </form>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(lvl.id)}>{labels.delete}</Button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={addSkillLevelAction.bind(null, slug)} className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor="new-level" className="sr-only">{labels.add}</FieldLabel>
          <Input id="new-level" name="name" placeholder={labels.addPlaceholder} required />
        </Field>
        <Button type="submit">{labels.add}</Button>
      </form>
    </div>
  );
}

function ArrowForm({ slug, id, direction, disabled, label, children }: {
  slug: string; id: string; direction: 'up' | 'down'; disabled: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <form action={reorderSkillLevelAction.bind(null, slug)}>
      <input type="hidden" name="skillLevelId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <Button type="submit" size="icon" variant="ghost" aria-label={label} disabled={disabled}>{children}</Button>
    </form>
  );
}
```

- [ ] **Step 5: Verify build + lint**

Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → compiles, new route `/s/[slug]/manage/skill-levels` listed
Manual check (dev): as the demo club owner, visit `/manage/skill-levels`, add/rename/reorder/delete levels.

- [ ] **Step 6: Commit**

```bash
git add app/s/\[slug\]/manage/skill-levels messages/
git commit -m "feat(manage): skill-levels editor with reorder and guarded delete"
```

---

## Task 6: Boats logic core

**Files:**
- Create: `src/lib/boats.ts`
- Test: `src/lib/boats.integration.test.ts`

**Interfaces:**
- Produces:
  - `listBoats(db, clubId): Promise<BoatType[]>`
  - `createBoat(db, clubId, input): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }>`
  - `updateBoat(db, { clubId, boatId, ...input }): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }>`
  - `setBoatActive(db, { clubId, boatId, active }): Promise<boolean>`
  - `type BoatType = typeof boatTypes.$inferSelect`, `interface BoatInput`

- [ ] **Step 1: Write failing integration tests**

Create `src/lib/boats.integration.test.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { createBoat, listBoats, setBoatActive, updateBoat } from './boats';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('boats', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates and lists boats scoped to the club', async () => {
    const c = await newClub('boat-c');
    const r = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 2 });
    expect(r.ok).toBe(true);
    const boats = await listBoats(db, c.id);
    expect(boats).toHaveLength(1);
    expect(boats[0].name).toBe('Quad');
    expect(boats[0].active).toBe(true);
  });

  it('rejects a min skill level from another club', async () => {
    const c1 = await newClub('boat-s1');
    const c2 = await newClub('boat-s2');
    const [otherLvl] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Adv', rank: 1 }).returning();
    const r = await createBoat(db, c1.id, { name: 'Double', seats: 2, minSkillLevelId: otherLvl.id, allowedPayment: 'regular_only', minAttendance: null });
    expect(r).toEqual({ ok: false, error: 'skill_not_in_club' });
    expect(await listBoats(db, c1.id)).toHaveLength(0);
  });

  it('updates only within the same club and validates the skill FK', async () => {
    const c1 = await newClub('boat-u1');
    const c2 = await newClub('boat-u2');
    const created = await createBoat(db, c1.id, { name: 'Single', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null });
    if (!created.ok) throw new Error('setup');
    // wrong club → not_found
    expect(await updateBoat(db, { clubId: c2.id, boatId: created.id, name: 'Hacked', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null })).toEqual({ ok: false, error: 'not_found' });
    // valid update
    expect(await updateBoat(db, { clubId: c1.id, boatId: created.id, name: 'Skiff', seats: 1, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null })).toEqual({ ok: true });
    const [after] = await listBoats(db, c1.id);
    expect(after.name).toBe('Skiff');
    expect(after.allowedPayment).toBe('multisport_only');
  });

  it('soft-deactivates and reactivates', async () => {
    const c = await newClub('boat-a');
    const created = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null });
    if (!created.ok) throw new Error('setup');
    expect(await setBoatActive(db, { clubId: c.id, boatId: created.id, active: false })).toBe(true);
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test:integration src/lib/boats.integration.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the logic**

Create `src/lib/boats.ts`:

```typescript
import { and, asc, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, skillLevels } from '@/db/schema';

export type BoatType = typeof boatTypes.$inferSelect;
export type AllowedPayment = 'regular_only' | 'multisport_only' | 'both';

export interface BoatInput {
  name: string;
  seats: number;
  minSkillLevelId: string | null;
  allowedPayment: AllowedPayment;
  minAttendance: number | null;
}

export function listBoats(db: DB, clubId: string): Promise<BoatType[]> {
  return db.select().from(boatTypes).where(eq(boatTypes.clubId, clubId)).orderBy(asc(boatTypes.name));
}

async function skillBelongsToClub(db: DB, clubId: string, skillLevelId: string): Promise<boolean> {
  const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
    .where(and(eq(skillLevels.id, skillLevelId), eq(skillLevels.clubId, clubId))).limit(1);
  return Boolean(lvl);
}

export async function createBoat(db: DB, clubId: string, input: BoatInput): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  const [row] = await db.insert(boatTypes).values({
    clubId, name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
    allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
  }).returning({ id: boatTypes.id });
  return { ok: true, id: row.id };
}

export async function updateBoat(db: DB, input: { clubId: string; boatId: string } & BoatInput): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, input.clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  const res = await db.update(boatTypes).set({
    name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
    allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
  }).where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
    .returning({ id: boatTypes.id });
  return res.length > 0 ? { ok: true } : { ok: false, error: 'not_found' };
}

export async function setBoatActive(db: DB, input: { clubId: string; boatId: string; active: boolean }): Promise<boolean> {
  const res = await db.update(boatTypes).set({ active: input.active })
    .where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
    .returning({ id: boatTypes.id });
  return res.length > 0;
}
```

- [ ] **Step 4: Run — verify pass, then lint**

Run: `pnpm test:integration src/lib/boats.integration.test.ts` → all PASS
Run: `pnpm lint:fix && pnpm lint` → 0 problems

- [ ] **Step 5: Commit**

```bash
git add src/lib/boats.ts src/lib/boats.integration.test.ts
git commit -m "feat(boats): add club-scoped boat-type CRUD with eligibility FK check"
```

---

## Task 7: Boats editor UI

**Files:**
- Create: `app/s/[slug]/manage/boats/page.tsx`
- Create: `app/s/[slug]/manage/boats/actions.ts`
- Create: `app/s/[slug]/manage/boats/boats-editor.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `requireOwner`, Task 6 logic, `listSkillLevels` (Task 3), `boatSchema` (Task 2).

- [ ] **Step 1: Add i18n keys**

Add a `manage.boats` group to both message files. `messages/en.json`:

```json
"boats": {
  "navLabel": "Boats",
  "title": "Boats",
  "intro": "Define your boat types. Seats set the session capacity; eligibility limits who can book.",
  "name": "Name",
  "seats": "Seats",
  "minSkill": "Minimum skill level",
  "noMinSkill": "No requirement",
  "payment": "Allowed payment",
  "paymentRegular": "Cash only",
  "paymentMultisport": "MultiSport only",
  "paymentBoth": "Both",
  "minAttendance": "Advisory minimum attendance",
  "add": "Add boat",
  "edit": "Edit",
  "save": "Save",
  "cancel": "Cancel",
  "deactivate": "Deactivate",
  "activate": "Activate",
  "inactive": "Inactive",
  "empty": "No boats yet.",
  "needSkillLevels": "Tip: add skill levels first if you want to require a minimum level."
}
```

`messages/tr.json` (same keys): `navLabel`/`title` "Tekneler", `intro` "Tekne tiplerinizi tanımlayın. Koltuklar oturum kapasitesini belirler; uygunluk kimin rezervasyon yapabileceğini sınırlar.", `name` "Ad", `seats` "Koltuk", `minSkill` "Asgari seviye", `noMinSkill` "Şart yok", `payment` "İzinli ödeme", `paymentRegular` "Sadece nakit", `paymentMultisport` "Sadece MultiSport", `paymentBoth` "İkisi de", `minAttendance` "Tavsiye edilen asgari katılım", `add` "Tekne ekle", `edit` "Düzenle", `save` "Kaydet", `cancel` "İptal", `deactivate` "Pasifleştir", `activate` "Aktifleştir", `inactive` "Pasif", `empty` "Henüz tekne yok.", `needSkillLevels` "İpucu: asgari seviye şartı koymak istiyorsanız önce seviye ekleyin."

- [ ] **Step 2: Write the server actions**

Create `app/s/[slug]/manage/boats/actions.ts`:

```typescript
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { createBoat, setBoatActive, updateBoat } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { boatSchema } from '@/lib/schemas';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/boats`);
  revalidatePath(`/s/${slug}/manage`);
}

function parseBoat(formData: FormData) {
  return boatSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    seats: formData.get('seats'),
    minSkillLevelId: (String(formData.get('minSkillLevelId') ?? '') || null),
    allowedPayment: formData.get('allowedPayment'),
    minAttendance: (String(formData.get('minAttendance') ?? '') || null),
  });
}

export async function createBoatAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  const parsed = parseBoat(formData);
  if (!parsed.success) return;
  await createBoat(db, club.id, parsed.data);
  refresh(slug);
}

export async function updateBoatAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  const parsed = parseBoat(formData);
  if (!parsed.success) return;
  await updateBoat(db, { clubId: club.id, boatId: String(formData.get('boatId')), ...parsed.data });
  refresh(slug);
}

export async function setBoatActiveAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  await setBoatActive(db, { clubId: club.id, boatId: String(formData.get('boatId')), active: formData.get('active') === 'true' });
  refresh(slug);
}
```

Note on the zod input: `seats`/`minAttendance` arrive as `FormDataEntryValue`; `boatSchema` uses `z.coerce.number()` so strings coerce. `minAttendance` empty string → `null` before parse (as above). `minSkillLevelId` empty → `null`.

- [ ] **Step 3: Write the page (server component)**

Create `app/s/[slug]/manage/boats/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listSkillLevels } from '@/lib/skill-levels';

import { BoatsEditor } from './boats-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BoatsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/boats');
  const t = await getTranslations('manage.boats');
  const [boats, levels] = await Promise.all([listBoats(db, club.id), listSkillLevels(db, club.id)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <BoatsEditor
        slug={slug}
        boats={boats.map((b) => ({ id: b.id, name: b.name, seats: b.seats, minSkillLevelId: b.minSkillLevelId, allowedPayment: b.allowedPayment, minAttendance: b.minAttendance, active: b.active }))}
        levels={levels.map((l) => ({ id: l.id, name: l.name }))}
        labels={{
          name: t('name'), seats: t('seats'), minSkill: t('minSkill'), noMinSkill: t('noMinSkill'),
          payment: t('payment'), paymentRegular: t('paymentRegular'), paymentMultisport: t('paymentMultisport'),
          paymentBoth: t('paymentBoth'), minAttendance: t('minAttendance'), add: t('add'), edit: t('edit'),
          save: t('save'), cancel: t('cancel'), deactivate: t('deactivate'), activate: t('activate'),
          inactive: t('inactive'), empty: t('empty'), needSkillLevels: t('needSkillLevels'),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Write the editor (client component)**

Create `app/s/[slug]/manage/boats/boats-editor.tsx`. It renders a list of boats (each with an inline edit form) and one add form. Inputs use existing `ui` primitives (`Input`, `Field`, `FieldLabel`, `Button`) plus native `<select>` (min skill + allowed payment) matching the precedent in `manage/members/skill-level-select.tsx`. Full code:

```tsx
'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { createBoatAction, setBoatActiveAction, updateBoatAction } from './actions';

type Level = { id: string; name: string };
type Boat = { id: string; name: string; seats: number; minSkillLevelId: string | null; allowedPayment: 'regular_only' | 'multisport_only' | 'both'; minAttendance: number | null; active: boolean };
type Labels = {
  name: string; seats: string; minSkill: string; noMinSkill: string; payment: string;
  paymentRegular: string; paymentMultisport: string; paymentBoth: string; minAttendance: string;
  add: string; edit: string; save: string; cancel: string; deactivate: string; activate: string;
  inactive: string; empty: string; needSkillLevels: string;
};

const selectClass = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

function BoatFields({ boat, levels, labels }: { boat?: Boat; levels: Level[]; labels: Labels }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="name">{labels.name}</FieldLabel>
        <Input id="name" name="name" defaultValue={boat?.name} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="seats">{labels.seats}</FieldLabel>
        <Input id="seats" name="seats" type="number" min={1} max={16} defaultValue={boat?.seats ?? 1} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="minSkillLevelId">{labels.minSkill}</FieldLabel>
        <select id="minSkillLevelId" name="minSkillLevelId" defaultValue={boat?.minSkillLevelId ?? ''} className={selectClass}>
          <option value="">{labels.noMinSkill}</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="allowedPayment">{labels.payment}</FieldLabel>
        <select id="allowedPayment" name="allowedPayment" defaultValue={boat?.allowedPayment ?? 'both'} className={selectClass}>
          <option value="both">{labels.paymentBoth}</option>
          <option value="regular_only">{labels.paymentRegular}</option>
          <option value="multisport_only">{labels.paymentMultisport}</option>
        </select>
      </Field>
      <Field className="col-span-2">
        <FieldLabel htmlFor="minAttendance">{labels.minAttendance}</FieldLabel>
        <Input id="minAttendance" name="minAttendance" type="number" min={1} defaultValue={boat?.minAttendance ?? ''} />
      </Field>
    </div>
  );
}

export function BoatsEditor({ slug, boats, levels, labels }: { slug: string; boats: Boat[]; levels: Level[]; labels: Labels }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 && <p className="text-xs text-muted-foreground">{labels.needSkillLevels}</p>}
      {boats.length === 0 && !adding ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="flex flex-col gap-2">
          {boats.map((b) => (
            <li key={b.id} className="rounded-lg border p-3">
              {editing === b.id ? (
                <form action={updateBoatAction.bind(null, slug)} className="flex flex-col gap-3" onSubmit={() => setEditing(null)}>
                  <input type="hidden" name="boatId" value={b.id} />
                  <BoatFields boat={b} levels={levels} labels={labels} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">{labels.save}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{labels.cancel}</Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{b.name} {!b.active && <span className="text-xs text-muted-foreground">({labels.inactive})</span>}</div>
                    <div className="text-sm text-muted-foreground">{labels.seats}: {b.seats}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(b.id)}>{labels.edit}</Button>
                    <form action={setBoatActiveAction.bind(null, slug)}>
                      <input type="hidden" name="boatId" value={b.id} />
                      <input type="hidden" name="active" value={b.active ? 'false' : 'true'} />
                      <Button type="submit" size="sm" variant="ghost">{b.active ? labels.deactivate : labels.activate}</Button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form action={createBoatAction.bind(null, slug)} className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={() => setAdding(false)}>
          <BoatFields levels={levels} labels={labels} />
          <div className="flex gap-2">
            <Button type="submit" size="sm">{labels.save}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>{labels.cancel}</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>{labels.add}</Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build + lint**

Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → route `/s/[slug]/manage/boats` present.

- [ ] **Step 6: Commit**

```bash
git add app/s/\[slug\]/manage/boats messages/
git commit -m "feat(manage): boats editor with eligibility and soft-deactivate"
```

---

## Task 8: Club-profile logic core (incl. upload owner-check)

**Files:**
- Create: `src/lib/club-profile.ts`
- Test: `src/lib/club-profile.integration.test.ts`

**Interfaces:**
- Produces:
  - `updateClubProfile(db, clubId, input: ProfileInput): Promise<boolean>`
  - `listSocials(db, clubId): Promise<ClubSocial[]>`
  - `addSocial(db, { clubId, platform, handle }): Promise<string>`
  - `removeSocial(db, { clubId, socialId }): Promise<boolean>`
  - `ownedClubId(db, userId, slug): Promise<string | null>` — resolves the club id iff `userId` is its approved owner (used by the logo-upload route to authorize before granting a Blob token)
  - `interface ProfileInput { name; tagline; description; phone; brandAccent; headingFont; logoUrl }` (all optional fields `string | null`, `headingFont: 'default'|'premium'`)

- [ ] **Step 1: Write failing integration tests**

Create `src/lib/club-profile.integration.test.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { addSocial, listSocials, ownedClubId, removeSocial, updateClubProfile } from './club-profile';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('club-profile', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('updates profile fields and logo', async () => {
    const c = await newClub('cp-upd');
    expect(await updateClubProfile(db, c.id, { name: 'Bebek Kürek', tagline: 'İstanbul', description: 'Bir kulüp', phone: '555', brandAccent: '#0E9E93', headingFont: 'premium', logoUrl: 'https://blob/x.png' })).toBe(true);
    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(after.name).toBe('Bebek Kürek');
    expect(after.tagline).toBe('İstanbul');
    expect(after.headingFont).toBe('premium');
    expect(after.logoUrl).toBe('https://blob/x.png');
  });

  it('adds, lists, and removes socials scoped to the club', async () => {
    const c1 = await newClub('cp-s1');
    const c2 = await newClub('cp-s2');
    const id = await addSocial(db, { clubId: c1.id, platform: 'instagram', handle: 'bebek' });
    expect((await listSocials(db, c1.id)).map((s) => s.handle)).toEqual(['bebek']);
    // wrong club cannot remove
    expect(await removeSocial(db, { clubId: c2.id, socialId: id })).toBe(false);
    expect(await removeSocial(db, { clubId: c1.id, socialId: id })).toBe(true);
    expect(await listSocials(db, c1.id)).toHaveLength(0);
  });

  it('ownedClubId returns the club only for an approved owner', async () => {
    const c = await newClub('cp-own');
    const owner = `o-${Date.now()}`;
    const member = `m-${Date.now()}`;
    await db.insert(schema.user).values([{ id: owner, name: 'O', email: `${owner}@t.co` }, { id: member, name: 'M', email: `${member}@t.co` }]);
    await db.insert(schema.memberships).values({ userId: owner, clubId: c.id, role: 'owner', status: 'approved' });
    await db.insert(schema.memberships).values({ userId: member, clubId: c.id, role: 'member', status: 'approved' });
    expect(await ownedClubId(db, owner, c.slug)).toBe(c.id);
    expect(await ownedClubId(db, member, c.slug)).toBeNull();
    expect(await ownedClubId(db, owner, 'no-such-slug')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test:integration src/lib/club-profile.integration.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the logic**

Create `src/lib/club-profile.ts`:

```typescript
import { and, asc, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubSocials, clubs, memberships } from '@/db/schema';

export interface ProfileInput {
  name: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  brandAccent: string | null;
  headingFont: 'default' | 'premium';
  logoUrl: string | null;
}

export async function updateClubProfile(db: DB, clubId: string, input: ProfileInput): Promise<boolean> {
  const res = await db.update(clubs).set({
    name: input.name, tagline: input.tagline, description: input.description,
    phone: input.phone, brandAccent: input.brandAccent, headingFont: input.headingFont,
    logoUrl: input.logoUrl,
  }).where(eq(clubs.id, clubId)).returning({ id: clubs.id });
  return res.length > 0;
}

export type ClubSocial = typeof clubSocials.$inferSelect;

export function listSocials(db: DB, clubId: string): Promise<ClubSocial[]> {
  return db.select().from(clubSocials).where(eq(clubSocials.clubId, clubId)).orderBy(asc(clubSocials.platform));
}

export async function addSocial(db: DB, input: { clubId: string; platform: string; handle: string }): Promise<string> {
  const [row] = await db.insert(clubSocials).values({ clubId: input.clubId, platform: input.platform, handle: input.handle }).returning({ id: clubSocials.id });
  return row.id;
}

export async function removeSocial(db: DB, input: { clubId: string; socialId: string }): Promise<boolean> {
  const res = await db.delete(clubSocials)
    .where(and(eq(clubSocials.id, input.socialId), eq(clubSocials.clubId, input.clubId)))
    .returning({ id: clubSocials.id });
  return res.length > 0;
}

export async function ownedClubId(db: DB, userId: string, slug: string): Promise<string | null> {
  const [row] = await db.select({ clubId: clubs.id })
    .from(clubs)
    .innerJoin(memberships, eq(memberships.clubId, clubs.id))
    .where(and(
      eq(clubs.slug, slug),
      eq(memberships.userId, userId),
      eq(memberships.role, 'owner'),
      eq(memberships.status, 'approved'),
    ))
    .limit(1);
  return row?.clubId ?? null;
}
```

- [ ] **Step 4: Run — verify pass, then lint**

Run: `pnpm test:integration src/lib/club-profile.integration.test.ts` → all PASS
Run: `pnpm lint:fix && pnpm lint` → 0 problems

- [ ] **Step 5: Commit**

```bash
git add src/lib/club-profile.ts src/lib/club-profile.integration.test.ts
git commit -m "feat(club-profile): profile/socials logic and owner-upload check"
```

---

## Task 9: Vercel Blob client-upload route

**Files:**
- Modify: `package.json` (add `@vercel/blob`)
- Modify: `src/env.ts` (add `BLOB_READ_WRITE_TOKEN`)
- Create: `app/api/club-logo/upload/route.ts`

**Interfaces:**
- Consumes: `ownedClubId` (Task 8), `getCurrentUser` (`@/lib/session`).
- Produces: `POST /api/club-logo/upload` — a Vercel Blob `handleUpload` handler that grants a scoped client token only to the approved owner of the club named in `clientPayload` (the slug), constraining content type and size.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add @vercel/blob`
Then verify it is a maintained, current release: `pnpm view @vercel/blob version time.modified` (expect a recent modified date; it is Vercel-published). Confirm the installed `.d.ts` exports `upload` and `handleUpload` from `@vercel/blob/client`: `grep -rl "export declare function handleUpload" node_modules/@vercel/blob/dist`.

- [ ] **Step 2: Add the env var**

In `src/env.ts`, add to the `server` block:

```typescript
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
```

(Optional so local dev / test / build without Blob configured still boots; the route fails at call time with a clear Blob error if the token is missing, which is acceptable — logo upload is not on the critical signup/booking path.)

- [ ] **Step 3: Write the route handler**

Create `app/api/club-logo/upload/route.ts`:

```typescript
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { ownedClubId } from '@/lib/club-profile';
import { getCurrentUser } from '@/lib/session';

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const user = await getCurrentUser();
        if (!user) throw new Error('Not authorized');
        const clubId = await ownedClubId(db, user.id, clientPayload ?? '');
        if (!clubId) throw new Error('Not authorized');
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ clubId }),
        };
      },
      // No onUploadCompleted callback: the browser receives the blob URL directly
      // from upload() and submits it with the profile form, which persists it.
      // (An onUploadCompleted webhook cannot reach localhost during dev anyway.)
    });
    return NextResponse.json(json);
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 401 : 400 });
  }
}
```

The owner authorization is unit-covered via `ownedClubId` (Task 8's integration test proves owner→id, member→null, unknown-slug→null); this route is the thin adapter around it.

- [ ] **Step 4: Verify build + lint**

Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → route `/api/club-logo/upload` present; no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/env.ts app/api/club-logo
git commit -m "feat(upload): add owner-scoped Vercel Blob client-upload route for club logo"
```

---

## Task 10: Profile editor UI

**Files:**
- Create: `app/s/[slug]/manage/profile/page.tsx`
- Create: `app/s/[slug]/manage/profile/actions.ts`
- Create: `app/s/[slug]/manage/profile/profile-form.tsx`
- Create: `app/s/[slug]/manage/profile/logo-upload.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `requireOwner`, `updateClubProfile`/`listSocials`/`addSocial`/`removeSocial` (Task 8), `clubProfileSchema`/`socialSchema` (Task 2), `upload` from `@vercel/blob/client`.

- [ ] **Step 1: Add i18n keys**

Add a `manage.profile` group to both files. `messages/en.json`:

```json
"profile": {
  "navLabel": "Profile",
  "title": "Public profile",
  "intro": "This is what visitors see on your club page.",
  "name": "Club name",
  "tagline": "Tagline",
  "description": "Description",
  "phone": "Phone",
  "brandAccent": "Brand color",
  "headingFont": "Heading font",
  "fontDefault": "Default",
  "fontPremium": "Serif",
  "logo": "Logo",
  "logoUpload": "Upload image",
  "logoUploading": "Uploading…",
  "logoError": "Upload failed. Use a PNG/JPG/WebP/SVG under 2 MB.",
  "socials": "Social links",
  "socialPlatform": "Platform",
  "socialHandle": "Handle",
  "socialAdd": "Add link",
  "socialRemove": "Remove",
  "save": "Save profile",
  "saved": "Profile saved."
}
```

`messages/tr.json` (same keys): `navLabel`/`title` "Profil"/"Herkese açık profil", `intro` "Ziyaretçilerin kulüp sayfanızda gördüğü budur.", `name` "Kulüp adı", `tagline` "Slogan", `description` "Açıklama", `phone` "Telefon", `brandAccent` "Marka rengi", `headingFont` "Başlık yazı tipi", `fontDefault` "Varsayılan", `fontPremium` "Serif", `logo` "Logo", `logoUpload` "Görsel yükle", `logoUploading` "Yükleniyor…", `logoError` "Yükleme başarısız. 2 MB altında PNG/JPG/WebP/SVG kullanın.", `socials` "Sosyal bağlantılar", `socialPlatform` "Platform", `socialHandle` "Kullanıcı adı", `socialAdd` "Bağlantı ekle", `socialRemove` "Kaldır", `save` "Profili kaydet", `saved` "Profil kaydedildi."

- [ ] **Step 2: Write the server actions**

Create `app/s/[slug]/manage/profile/actions.ts`:

```typescript
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { addSocial, removeSocial, updateClubProfile } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';
import { clubProfileSchema, socialSchema } from '@/lib/schemas';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/profile`);
  revalidatePath(`/s/${slug}/manage`);
  revalidatePath(`/s/${slug}`); // public club page + metadata
}

export async function saveProfileAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  const parsed = clubProfileSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    tagline: String(formData.get('tagline') ?? '').trim() || undefined,
    description: String(formData.get('description') ?? '').trim() || undefined,
    phone: String(formData.get('phone') ?? '').trim() || undefined,
    brandAccent: String(formData.get('brandAccent') ?? '').trim() || undefined,
    headingFont: formData.get('headingFont') ?? 'default',
    logoUrl: String(formData.get('logoUrl') ?? '').trim() || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;
  await updateClubProfile(db, club.id, {
    name: d.name,
    tagline: d.tagline ?? null,
    description: d.description ?? null,
    phone: d.phone ?? null,
    brandAccent: d.brandAccent ?? null,
    headingFont: d.headingFont,
    logoUrl: d.logoUrl ? d.logoUrl : null,
  });
  refresh(slug);
}

export async function addSocialAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  const parsed = socialSchema.safeParse({
    platform: String(formData.get('platform') ?? '').trim(),
    handle: String(formData.get('handle') ?? '').trim(),
  });
  if (!parsed.success) return;
  await addSocial(db, { clubId: club.id, ...parsed.data });
  refresh(slug);
}

export async function removeSocialAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  await removeSocial(db, { clubId: club.id, socialId: String(formData.get('socialId')) });
  refresh(slug);
}
```

- [ ] **Step 3: Write the logo-upload client component**

Create `app/s/[slug]/manage/profile/logo-upload.tsx`:

```tsx
'use client';
import { upload } from '@vercel/blob/client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function LogoUpload({ slug, initialUrl, labels }: {
  slug: string;
  initialUrl: string | null;
  labels: { logo: string; logoUpload: string; logoUploading: string; logoError: string };
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(false);
    try {
      const blob = await upload(`club-logos/${slug}/${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/club-logo/upload',
        clientPayload: slug,
      });
      setUrl(blob.url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{labels.logo}</span>
      <input type="hidden" name="logoUrl" value={url} />
      <div className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : <div className="h-16 w-16 rounded-full border border-dashed" />}
        <label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onChange} disabled={busy} className="hidden" />
          <Button type="button" variant="outline" size="sm" disabled={busy} asChild={false} onClick={(ev) => ev.currentTarget.previousElementSibling instanceof HTMLInputElement && ev.currentTarget.previousElementSibling.click()}>
            {busy ? labels.logoUploading : labels.logoUpload}
          </Button>
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{labels.logoError}</p>}
    </div>
  );
}
```

If wiring the hidden `<input type="file">` + `Button` proves fragile, use a plain styled `<label>` wrapping the file input instead of a `Button` — the requirement is only that a click opens the file picker and the chosen file uploads.

- [ ] **Step 4: Write the profile form (client, RHF for text fields)**

Create `app/s/[slug]/manage/profile/profile-form.tsx`. Text fields use react-hook-form + `zodResolver(clubProfileSchema)` for UX validation (mirroring `sign-up-form.tsx`), but the form submits to the `saveProfileAction` server action (which re-parses). Because the logo hidden input and the socials are managed outside RHF, submit via the server action directly and keep RHF only for inline field errors. Simplest robust approach: a plain `<form action={saveProfileAction.bind(null, slug)}>` with the `LogoUpload` inside, and native inputs styled with `Input`/`Field`; skip RHF here to avoid the action/RHF submit conflict. Full code:

```tsx
'use client';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { removeSocialAction, saveProfileAction, addSocialAction } from './actions';
import { LogoUpload } from './logo-upload';

type Social = { id: string; platform: string; handle: string };
type Club = { name: string; tagline: string | null; description: string | null; phone: string | null; brandAccent: string | null; headingFont: 'default' | 'premium'; logoUrl: string | null };

export function ProfileForm({ slug, club, socials }: { slug: string; club: Club; socials: Social[] }) {
  const t = useTranslations('manage.profile');
  return (
    <div className="flex flex-col gap-6">
      <form action={saveProfileAction.bind(null, slug)} className="flex flex-col gap-4">
        <LogoUpload slug={slug} initialUrl={club.logoUrl} labels={{ logo: t('logo'), logoUpload: t('logoUpload'), logoUploading: t('logoUploading'), logoError: t('logoError') }} />
        <Field>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" defaultValue={club.name} required minLength={2} maxLength={80} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tagline">{t('tagline')}</FieldLabel>
          <Input id="tagline" name="tagline" defaultValue={club.tagline ?? ''} maxLength={120} />
        </Field>
        <Field>
          <FieldLabel htmlFor="description">{t('description')}</FieldLabel>
          <textarea id="description" name="description" defaultValue={club.description ?? ''} maxLength={2000} rows={4}
            className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs" />
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
          <Input id="phone" name="phone" type="tel" defaultValue={club.phone ?? ''} maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="brandAccent">{t('brandAccent')}</FieldLabel>
            <Input id="brandAccent" name="brandAccent" type="color" defaultValue={club.brandAccent ?? '#0E9E93'} className="h-9 w-full" />
          </Field>
          <Field>
            <FieldLabel htmlFor="headingFont">{t('headingFont')}</FieldLabel>
            <select id="headingFont" name="headingFont" defaultValue={club.headingFont}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs">
              <option value="default">{t('fontDefault')}</option>
              <option value="premium">{t('fontPremium')}</option>
            </select>
          </Field>
        </div>
        <Button type="submit" className="self-start">{t('save')}</Button>
      </form>

      <section className="flex flex-col gap-3">
        <h3 className="font-heading font-semibold">{t('socials')}</h3>
        {socials.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {socials.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-3">
                <span className="text-sm">{s.platform} · {s.handle}</span>
                <form action={removeSocialAction.bind(null, slug)}>
                  <input type="hidden" name="socialId" value={s.id} />
                  <Button type="submit" size="sm" variant="ghost">{t('socialRemove')}</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addSocialAction.bind(null, slug)} className="flex items-end gap-2">
          <Field className="flex-1">
            <FieldLabel htmlFor="platform">{t('socialPlatform')}</FieldLabel>
            <Input id="platform" name="platform" placeholder="instagram" required maxLength={40} />
          </Field>
          <Field className="flex-1">
            <FieldLabel htmlFor="handle">{t('socialHandle')}</FieldLabel>
            <Input id="handle" name="handle" placeholder="bebekrowing" required maxLength={80} />
          </Field>
          <Button type="submit">{t('socialAdd')}</Button>
        </form>
      </section>
    </div>
  );
}
```

(Note: `textarea` is a native element in a feature component — no `ui/` change. The `input type="color"` gives a simple accent picker with no new dependency.)

- [ ] **Step 5: Write the page (server component)**

Create `app/s/[slug]/manage/profile/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listSocials } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';

import { ProfileForm } from './profile-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/profile');
  const t = await getTranslations('manage.profile');
  const socials = await listSocials(db, club.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <ProfileForm
        slug={slug}
        club={{ name: club.name, tagline: club.tagline, description: club.description, phone: club.phone, brandAccent: club.brandAccent, headingFont: club.headingFont, logoUrl: club.logoUrl }}
        socials={socials.map((s) => ({ id: s.id, platform: s.platform, handle: s.handle }))}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify build + lint**

Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → route `/s/[slug]/manage/profile` present.
Manual (dev, requires `BLOB_READ_WRITE_TOKEN` for the upload leg): edit fields, add/remove a social, save; confirm the public club page reflects changes.

- [ ] **Step 7: Commit**

```bash
git add app/s/\[slug\]/manage/profile messages/
git commit -m "feat(manage): public profile editor with logo upload and socials"
```

---

## Task 11: Manage nav + setup checklist

**Files:**
- Create: `app/s/[slug]/manage/_nav.tsx`
- Create: `app/s/[slug]/manage/page.tsx`
- Modify: `app/s/[slug]/manage/layout.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `requireOwner`, `listSkillLevels`, `listBoats`.

- [ ] **Step 1: Add i18n keys**

Add to `manage` (top level, alongside existing keys) in both files. `messages/en.json`:

```json
"overviewNav": "Overview",
"setupTitle": "Finish setting up your club",
"setupIntro": "Complete these to open bookings later.",
"setupSkill": "Add skill levels",
"setupBoats": "Add at least one boat",
"setupProfile": "Complete your public profile",
"setupDone": "Done",
"setupTodo": "To do"
```

`messages/tr.json`: `overviewNav` "Genel bakış", `setupTitle` "Kulüp kurulumunu tamamlayın", `setupIntro` "Daha sonra rezervasyonları açmak için bunları tamamlayın.", `setupSkill` "Seviye ekle", `setupBoats` "En az bir tekne ekle", `setupProfile` "Herkese açık profili tamamla", `setupDone` "Tamam", `setupTodo` "Yapılacak".

- [ ] **Step 2: Write the nav (client component, active-link)**

Create `app/s/[slug]/manage/_nav.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const items = [
  { href: '', key: 'overviewNav' },
  { href: '/profile', key: 'profile' },
  { href: '/skill-levels', key: 'skillLevels' },
  { href: '/boats', key: 'boats' },
  { href: '/members', key: 'members' },
] as const;

export function ManageNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const t = useTranslations('manage');
  const base = `/s/${slug}/manage`;
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((it) => {
        const href = `${base}${it.href}`;
        const active = pathname === href;
        const label = it.key === 'overviewNav' ? t('overviewNav')
          : it.key === 'members' ? t('members')
          : t(`${it.key}.navLabel`);
        return (
          <Link key={it.href || 'overview'} href={href}
            className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-brand font-medium text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

(Note: the club public page is served under the rewritten path `/s/[slug]/...`, so `usePathname()` returns `/s/{slug}/manage/...` — matching `base`. Confirm during the manual check; if the proxy rewrite makes `usePathname` return the public path without the `/s/{slug}` prefix, compare against the suffix instead.)

- [ ] **Step 3: Render the nav in the layout**

Modify `app/s/[slug]/manage/layout.tsx` to render `ManageNav` under the title:

```tsx
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { requireOwner } from '@/lib/membership';

import { ManageNav } from './_nav';

export default async function ManageLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireOwner(slug);
  const t = await getTranslations('manage');
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 font-heading text-2xl font-bold text-brand">{t('title')}</h1>
      <ManageNav slug={slug} />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Write the setup-checklist index page**

Create `app/s/[slug]/manage/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listSkillLevels } from '@/lib/skill-levels';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');
  const [levels, boats] = await Promise.all([listSkillLevels(db, club.id), listBoats(db, club.id)]);

  const checklist = [
    { done: levels.length > 0, label: t('setupSkill'), href: `/s/${slug}/manage/skill-levels` },
    { done: boats.some((b) => b.active), label: t('setupBoats'), href: `/s/${slug}/manage/boats` },
    { done: Boolean(club.tagline || club.description), label: t('setupProfile'), href: `/s/${slug}/manage/profile` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('setupTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('setupIntro')}</p>
      </div>
      <ul className="divide-y rounded-lg border">
        {checklist.map((item) => (
          <li key={item.href} className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2">
              <span aria-hidden className={item.done ? 'text-brand' : 'text-muted-foreground'}>{item.done ? '✓' : '○'}</span>
              <span className={item.done ? 'text-muted-foreground line-through' : 'font-medium'}>{item.label}</span>
            </span>
            <Link href={item.href} className="text-sm text-primary hover:underline">
              {item.done ? t('setupDone') : t('setupTodo')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Verify build + lint**

Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → `/s/[slug]/manage` index present; nav renders on all manage pages.
Manual (dev): visit `/manage` as owner — checklist reflects real state, links work, active nav tab highlights per page.

- [ ] **Step 6: Commit**

```bash
git add app/s/\[slug\]/manage/_nav.tsx app/s/\[slug\]/manage/page.tsx app/s/\[slug\]/manage/layout.tsx messages/
git commit -m "feat(manage): add section nav and setup checklist overview"
```

---

## Task 12: Wire profile into public SEO metadata

**Files:**
- Modify: `app/s/[slug]/page.tsx`
- Modify: `src/lib/seo.ts` (only if needed — see below)
- Modify: `src/lib/seo.test.ts`

**Interfaces:**
- `buildClubMetadata` already accepts `description` and `club.logoUrl`. The change is to feed the real profile fields from the club page, and cover it in the seo test.

- [ ] **Step 1: Add a failing seo test**

Append to `src/lib/seo.test.ts` (follow the file's existing import/style):

```typescript
it('uses the provided description and the club logo for OpenGraph', () => {
  const meta = buildClubMetadata({
    club: { slug: 'bebek', name: 'Bebek', status: 'active', logoUrl: 'https://blob/logo.png' },
    description: 'Boğaz’da kürek',
    origin: { protocol: 'https:', rootDomain: 'oarly.sbs' },
  });
  expect(meta.description).toBe('Boğaz’da kürek');
  expect(meta.openGraph?.images).toEqual(['https://blob/logo.png']);
});
```

(Match the `AppOrigin` shape used elsewhere in `seo.test.ts`; if the existing tests construct `origin` differently, mirror that construction exactly.)

- [ ] **Step 2: Run — verify pass or failure**

Run: `pnpm vitest run src/lib/seo.test.ts`
Expected: PASS already if `buildClubMetadata` is unchanged (this test documents current behavior). If it fails on the `origin` shape, fix the test to match the real `AppOrigin`. No `seo.ts` change is required for images/description — they already flow through.

- [ ] **Step 3: Feed real profile fields from the club page**

In `app/s/[slug]/page.tsx`, update `generateMetadata` to prefer the profile's description/tagline:

```tsx
  return buildClubMetadata({
    club,
    description: club.description ?? club.tagline ?? t('metaDescription', { name: club.name }),
    origin: parseAppOrigin(env.APP_URL),
  });
```

Optionally surface `tagline`/`description` in the visible page body (below the club name) so the profile edits are visible without inspecting metadata:

```tsx
      <h1 className="font-heading text-3xl font-bold text-brand">{club.name}</h1>
      {club.tagline ? <p className="text-lg text-muted-foreground">{club.tagline}</p> : null}
      {club.description ? <p className="text-muted-foreground">{club.description}</p> : <p className="text-muted-foreground">{t('joinBody')}</p>}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/lib/seo.test.ts` → PASS
Run: `pnpm lint:fix && pnpm lint` → 0 problems
Run: `pnpm build` → OK

- [ ] **Step 5: Commit**

```bash
git add app/s/\[slug\]/page.tsx src/lib/seo.ts src/lib/seo.test.ts
git commit -m "feat(seo): use club tagline/description and logo in public metadata"
```

---

## Final verification (before the whole-branch review)

Run the full green bar and confirm each passes:

- `pnpm lint` → 0 problems (`--max-warnings 0`)
- `pnpm exec tsc --noEmit` (or the project's typecheck) → clean
- `pnpm test` → unit tests pass
- `pnpm test:integration` → all pass (test PG on :5433 must be running: `docker.exe start oarly-test-pg oarly-postgres-dev-1`)
- `pnpm build` → compiles; new routes present: `/s/[slug]/manage`, `/manage/profile`, `/manage/skill-levels`, `/manage/boats`, `/api/club-logo/upload`

## Self-review notes (author)

- **Spec coverage:** profile (name/tagline/description/phone/socials/brand/logo) ✓ Task 1/8/10/12; skill levels (add/rename/reorder/delete, ordered) ✓ Task 3/5; boats (CRUD/eligibility/soft-delete/advisory min) ✓ Task 6/7; setup checklist ✓ Task 11; carry-forwards (tagline/description+OG ✓ Task 1/12; assignSkillLevel gate ✓ Task 4).
- **Out of scope confirmed absent:** no schedule windows/slots, no wizard, no physical inventory, no booking-side consumption.
- **Type consistency:** `ProfileInput`, `BoatInput`, `SkillLevel`, `BoatType`, `ClubSocial` defined once and imported; `AllowedPayment` enum matches `allowedPaymentEnum`; `headingFont` union matches `headingFontEnum`.
- **Known risk to watch in review:** the reorder sentinel (`-cur.rank`) correctness under the unique index (Task 3 test asserts it); `usePathname` prefix under the tenant rewrite for the nav active-state (Task 11 note); the `LogoUpload` file-input/Button click wiring (Task 10 fallback noted).
