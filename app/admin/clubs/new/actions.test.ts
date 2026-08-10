import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, createClub, revalidatePath, getTranslations } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createClub: vi.fn(),
  revalidatePath: vi.fn(),
  getTranslations: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/session', () => ({ requireAdmin }));
vi.mock('@/lib/clubs-admin', () => ({ createClub }));
vi.mock('next-intl/server', () => ({ getTranslations }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { createClubAction } from './actions';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = { name: 'Bebek Kürek Kulübü', slug: 'bebek', ownerEmail: 'owner@example.com' };

/**
 * The server half of the echo, for the reason `app/request-club/actions.test.ts` gives: the
 * page test mocks this action, so it cannot see the echo removed from here.
 *
 * Three inputs with no `defaultValue`, so a refusal WIPED all three rather than reverting
 * them — and both refusals are ordinary rather than crafted.
 */
describe('createClubAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: 'admin-1' });
    getTranslations.mockResolvedValue((key: string) => key);
    createClub.mockResolvedValue({ ok: true, id: 'club-1' });
  });

  it('redirects on success, carrying no state back', async () => {
    await expect(createClubAction({}, form(VALID))).rejects.toThrow('REDIRECT:/admin?created=1');
  });

  // Each of these names ONE field and silently emptied the other two, one of which is an
  // email address — the field it is least reasonable to ask someone to retype from memory.
  it.each(['slug_taken', 'slug_reserved', 'slug_invalid', 'owner_not_found'])(
    'hands all three submitted values back when refused with %s', async (error) => {
      createClub.mockResolvedValue({ ok: false, error });

      const state = await createClubAction({}, form(VALID));

      expect(state.values).toEqual(VALID);
      expect(Object.keys(state.errors ?? {})).toHaveLength(1);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('hands the values back when the payload does not parse', async () => {
    const submitted = { name: 'x', slug: 'x', ownerEmail: 'not-an-email' };

    const state = await createClubAction({}, form(submitted));

    expect(state.values).toEqual(submitted);
    expect(createClub).not.toHaveBeenCalled();
  });

  // Untrimmed and un-lowercased, asserted by VALUE: an echo of `parsed.data` would satisfy a
  // presence check while silently rewriting what the admin typed.
  it('echoes what was typed, not the normalised form the schema parsed', async () => {
    createClub.mockResolvedValue({ ok: false, error: 'slug_taken' });
    const submitted = { name: '  Bebek  ', slug: 'BEBEK', ownerEmail: '  Owner@Example.com ' };

    const state = await createClubAction({}, form(submitted));

    expect(state.values).toEqual(submitted);
  });
});
