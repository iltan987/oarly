import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireOwner, updateClubProfile, revalidatePath } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  updateClubProfile: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/membership', () => ({ requireOwner }));
vi.mock('@/lib/club-profile', () => ({
  updateClubProfile,
  addSocial: vi.fn(),
  removeSocial: vi.fn(),
}));

import { saveProfileAction } from './actions';

const CLUB_ID = 'club-id';
const USER_ID = 'owner-id';

const VALID = {
  name: 'Demo Kürek',
  tagline: 'sa',
  description: 'stored description',
  phone: '+905550001122',
  brandAccent: '#2563eb',
  headingFont: 'default',
  logoUrl: '',
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('saveProfileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOwner.mockResolvedValue({ club: { id: CLUB_ID }, user: { id: USER_ID } });
    updateClubProfile.mockResolvedValue(true);
  });

  it('persists a valid profile and revalidates the club', async () => {
    expect(await saveProfileAction('demo', null, form(VALID))).toEqual({ ok: true });
    expect(updateClubProfile).toHaveBeenCalledWith({}, CLUB_ID, expect.objectContaining({
      name: 'Demo Kürek', description: 'stored description',
    }), USER_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/s/demo');
  });

  /**
   * The refusal contract `profile-form.tsx` depends on. React 19 resets an uncontrolled
   * form after ANY completed form action, so unless the refused values come BACK the owner
   * watches a rewritten description revert to the stored one. Untrimmed, so what they get
   * back is what they have in front of them; `attempt` increments so the form's remount key
   * moves on every consecutive refusal (`club.updatedAt` cannot — nothing was persisted).
   */
  it('hands the submitted values back when the payload is refused', async () => {
    const submitted = { ...VALID, name: '  ', description: '  a rewritten description  ' };

    const first = await saveProfileAction('demo', null, form(submitted));

    expect(first).toEqual({
      ok: false,
      attempt: 1,
      values: {
        name: '  ',
        tagline: 'sa',
        description: '  a rewritten description  ',
        phone: '+905550001122',
        brandAccent: '#2563eb',
      },
    });
    expect(updateClubProfile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await saveProfileAction('demo', first, form(submitted)))
      .toMatchObject({ ok: false, attempt: 2 });
  });

  // The write itself failing (a deleted club) is a refusal too, and owes the same echo.
  it('hands the values back when the write refuses, not only the parse', async () => {
    updateClubProfile.mockResolvedValue(false);

    expect(await saveProfileAction('demo', null, form(VALID))).toEqual({
      ok: false,
      attempt: 1,
      values: {
        name: 'Demo Kürek', tagline: 'sa', description: 'stored description',
        phone: '+905550001122', brandAccent: '#2563eb',
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('starts the attempt count from a previous success', async () => {
    expect(await saveProfileAction('demo', { ok: true }, form({ ...VALID, name: 'x' })))
      .toMatchObject({ ok: false, attempt: 1 });
  });
});
