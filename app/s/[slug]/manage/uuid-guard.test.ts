/**
 * Every manage-area server action that binds a URL/form-supplied id into a `uuid`
 * column must REFUSE a malformed one, not let it reach Postgres.
 *
 * The failure this prevents is not a 500 page. These actions return
 * `ManageActionResult`, and their forms drive `useActionState`: a thrown 22P02
 * (`invalid input syntax for type uuid`) escapes the action, so instead of the
 * `{ ok: false }` the contract promises, the page is replaced by the error boundary
 * and every unsaved edit in the form is lost.
 *
 * The whole tree is covered in one file on purpose. It was 11-for-11 inconsistent
 * with `app/admin/**` (uniformly try/catch + `isUuid`) and with the member-facing
 * actions (uniformly `z.uuid()`); a per-file test would have made it 11 separate
 * things to remember instead of one invariant.
 *
 * The library functions are mocked and asserted NOT to have been called — reaching
 * the query at all is the defect, and a test that only checked the return value would
 * pass on an action that queried first and swallowed the error afterwards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const lib = vi.hoisted(() => ({
  setMembershipStatus: vi.fn(async () => true),
  assignSkillLevel: vi.fn(async () => true),
  updateBoat: vi.fn(async () => ({ ok: true as const })),
  setBoatActive: vi.fn(async () => true),
  renameSkillLevel: vi.fn(async () => true),
  reorderSkillLevel: vi.fn(async () => true),
  deleteSkillLevel: vi.fn(async () => true),
  updateWindow: vi.fn(async () => ({ ok: true as const })),
  createWindow: vi.fn(async () => ({ ok: true as const })),
  deleteWindow: vi.fn(async () => true),
  removeSocial: vi.fn(async () => true),
}));

vi.mock('@/lib/membership', () => ({
  requireOwner: async () => ({ club: { id: 'club-1', multisportEnabled: true }, user: { id: 'u1' } }),
}));
vi.mock('@/lib/members-admin', () => ({
  setMembershipStatus: lib.setMembershipStatus, assignSkillLevel: lib.assignSkillLevel,
}));
vi.mock('@/lib/boats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateBoat: lib.updateBoat, setBoatActive: lib.setBoatActive,
}));
vi.mock('@/lib/skill-levels', () => ({
  createSkillLevel: vi.fn(), renameSkillLevel: lib.renameSkillLevel,
  reorderSkillLevel: lib.reorderSkillLevel, deleteSkillLevel: lib.deleteSkillLevel,
}));
vi.mock('@/lib/schedule', () => ({
  createWindow: lib.createWindow, updateWindow: lib.updateWindow, deleteWindow: lib.deleteWindow,
}));
vi.mock('@/lib/club-profile', () => ({
  addSocial: vi.fn(), removeSocial: lib.removeSocial, updateClubProfile: vi.fn(),
}));

import { setBoatActiveAction, updateBoatAction } from './boats/actions';
import { approveMemberAction, assignSkillAction, rejectMemberAction } from './members/actions';
import { removeSocialAction } from './profile/actions';
import { deleteWindowAction, saveWindowAction } from './schedule/actions';
import { deleteSkillLevelAction, renameSkillLevelAction, reorderSkillLevelAction } from './skill-levels/actions';

const UUID = '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234';
/** Each of these reaches a `uuid` bind as 22P02. `''` is covered separately. */
const BAD = ['abc', '1', "'; DROP TABLE clubs; --", '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a123'];

/** `{ ok: false }` or `WindowFormState`'s `{ status: 'error' }`. */
function isRefusal(result: unknown): boolean {
  const r = result as Record<string, unknown>;
  return r?.ok === false || r?.status === 'error';
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

/** A window payload that passes `windowSchema`, so only the id is under test. */
function windowFields(): Record<string, string> {
  return {
    weekday: '1', startTime: '08:00', endTime: '10:00', defaultSessionMinutes: '120',
    boatTypeId: UUID, quantity: '1',
  };
}
/** A boat payload that passes `boatSchema`. */
function boatFields(): Record<string, string> {
  return { name: 'Quad', seats: '4', allowedPayment: 'both' };
}

/** [name, run(badId), the library spy that must not have been reached] */
const CASES: [string, (bad: string) => Promise<unknown>, () => ReturnType<typeof vi.fn>][] = [
  ['approveMemberAction', (b) => approveMemberAction('s', null, fd({ membershipId: b })), () => lib.setMembershipStatus],
  ['rejectMemberAction', (b) => rejectMemberAction('s', null, fd({ membershipId: b })), () => lib.setMembershipStatus],
  ['assignSkillAction (membershipId)', (b) => assignSkillAction('s', null, fd({ membershipId: b, skillLevelId: UUID })), () => lib.assignSkillLevel],
  ['assignSkillAction (skillLevelId)', (b) => assignSkillAction('s', null, fd({ membershipId: UUID, skillLevelId: b })), () => lib.assignSkillLevel],
  ['updateBoatAction', (b) => updateBoatAction('s', null, fd({ ...boatFields(), boatId: b })), () => lib.updateBoat],
  ['setBoatActiveAction', (b) => setBoatActiveAction('s', null, fd({ boatId: b, active: 'true' })), () => lib.setBoatActive],
  ['renameSkillLevelAction', (b) => renameSkillLevelAction('s', null, fd({ skillLevelId: b, name: 'Beginner' })), () => lib.renameSkillLevel],
  ['reorderSkillLevelAction', (b) => reorderSkillLevelAction('s', null, fd({ skillLevelId: b, direction: 'up' })), () => lib.reorderSkillLevel],
  ['deleteSkillLevelAction', (b) => deleteSkillLevelAction('s', null, fd({ skillLevelId: b })), () => lib.deleteSkillLevel],
  ['saveWindowAction', (b) => saveWindowAction('s', { status: 'idle', error: null }, fd({ ...windowFields(), windowId: b })), () => lib.updateWindow],
  ['deleteWindowAction', (b) => deleteWindowAction('s', null, fd({ windowId: b })), () => lib.deleteWindow],
  ['removeSocialAction', (b) => removeSocialAction('s', null, fd({ socialId: b })), () => lib.removeSocial],
];

beforeEach(() => { vi.clearAllMocks(); });

describe('manage actions refuse a malformed uuid before it reaches the database', () => {
  it.each(CASES)('%s', async (_name, run, spy) => {
    for (const bad of BAD) {
      vi.clearAllMocks();
      const result = await run(bad);
      // Never reaches the query: the throw is what escapes to the error boundary.
      expect(spy()).not.toHaveBeenCalled();
      // And it is a refusal the form can render, not `undefined` from a crash.
      // Two shapes: `ManageActionResult` for most, and `WindowFormState` for
      // `saveWindowAction`, which predates the shared type.
      expect(isRefusal(result), `${_name} returned ${JSON.stringify(result)}`).toBe(true);
    }
  });

  // Presence check first — a guard that refused EVERYTHING would pass every assertion
  // above while breaking the whole manage area. Each action must still work.
  it.each(CASES)('%s still reaches the library with a well-formed id', async (_name, run, spy) => {
    await run(UUID);
    expect(spy()).toHaveBeenCalledTimes(1);
  });

  // `saveWindowAction` has no `windowId` when creating, and an empty one must stay a
  // CREATE rather than becoming a refusal.
  it('saveWindowAction with no windowId still creates', async () => {
    await saveWindowAction('s', { status: 'idle', error: null }, fd(windowFields()));
    expect(lib.createWindow).toHaveBeenCalledTimes(1);
    expect(lib.updateWindow).not.toHaveBeenCalled();
  });

  // `assignSkillAction` clears a member's level with an empty value — that must not be
  // caught by the guard.
  it('assignSkillAction still clears a level with an empty skillLevelId', async () => {
    await assignSkillAction('s', null, fd({ membershipId: UUID, skillLevelId: '' }));
    expect(lib.assignSkillLevel).toHaveBeenCalledWith({}, expect.objectContaining({ skillLevelId: null }));
  });
});
