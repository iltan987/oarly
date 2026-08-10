'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { clampAllowedPayment, createBoat, setBoatActive, updateBoat } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { boatSchema } from '@/lib/schemas';
import { isUuid } from '@/lib/uuid';

import type { ManageActionResult } from '../action-result';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/boats`);
  revalidatePath(`/s/${slug}/manage`);
}

/**
 * The three fields the owner TYPES into a boat form, exactly as submitted.
 *
 * This form gets the same refused-values echo as `/manage/profile` and `/account`, and it
 * is the only other `ManageActionResult` form that does — see the note on that type. The
 * reason it qualifies: `boatSchema`'s `minAttendance <= seats` refinement is reachable by
 * ORDINARY use (a min attendance of 5 on a 4-seat boat is a plain mistake, not a crafted
 * payload), and React's post-action form reset then wiped all three fields of a boat the
 * owner had just filled in — not one value they can still see, but a whole row to retype.
 *
 * `minSkillLevelId` and `allowedPayment` are absent because they are hidden inputs driven by
 * React state inside `BoatFields`, and a form reset does not touch React state.
 */
export type BoatFormValues = {
  name: string;
  seats: string;
  minAttendance: string;
};

export type BoatSaveResult =
  | { ok: true }
  | { ok: false; values: BoatFormValues };

function submittedBoat(formData: FormData): BoatFormValues {
  return {
    name: String(formData.get('name') ?? ''),
    seats: String(formData.get('seats') ?? ''),
    minAttendance: String(formData.get('minAttendance') ?? ''),
  };
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

export async function createBoatAction(slug: string, _prev: BoatSaveResult | null, formData: FormData): Promise<BoatSaveResult> {
  const { club, user } = await requireOwner(slug, '/manage/boats');
  const refuse = (): BoatSaveResult => ({ ok: false, values: submittedBoat(formData) });
  const parsed = parseBoat(formData);
  if (!parsed.success) return refuse();
  const res = await createBoat(db, club.id, clampAllowedPayment(parsed.data, club.multisportEnabled), user.id);
  if (!res.ok) return refuse();
  refresh(slug);
  return { ok: true };
}

export async function updateBoatAction(slug: string, _prev: BoatSaveResult | null, formData: FormData): Promise<BoatSaveResult> {
  const { club, user } = await requireOwner(slug, '/manage/boats');
  const refuse = (): BoatSaveResult => ({ ok: false, values: submittedBoat(formData) });
  const parsed = parseBoat(formData);
  if (!parsed.success) return refuse();
  const boatId = String(formData.get('boatId'));
  if (!isUuid(boatId)) return refuse();
  const res = await updateBoat(db, { clubId: club.id, boatId, actorId: user.id, ...clampAllowedPayment(parsed.data, club.multisportEnabled) });
  if (!res.ok) return refuse();
  refresh(slug);
  return { ok: true };
}

export async function setBoatActiveAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/boats');
  const boatId = String(formData.get('boatId'));
  if (!isUuid(boatId)) return { ok: false };
  const ok = await setBoatActive(db, { clubId: club.id, boatId, active: formData.get('active') === 'true', actorId: user.id });
  if (ok) refresh(slug);
  return { ok };
}
