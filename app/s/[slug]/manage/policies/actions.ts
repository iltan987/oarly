'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { updateSchedulingSettings } from '@/lib/scheduling-settings';
import { schedulingSettingsSchema } from '@/lib/schemas';

export type PoliciesState =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'error'; cause: 'invalid_lead' | 'invalid_input' };

export async function savePoliciesAction(slug: string, _prev: PoliciesState, formData: FormData): Promise<PoliciesState> {
  const { club } = await requireOwner(slug, '/manage/policies');
  const leadRaw = String(formData.get('bookingOpenLeadDays') ?? '').trim();
  const cutoffRaw = String(formData.get('cancelCutoffHours') ?? '').trim();
  const waitlistRaw = String(formData.get('waitlistCapacity') ?? '').trim();
  const parsed = schedulingSettingsSchema.safeParse({
    bookingOpenMode: formData.get('bookingOpenMode'),
    bookingOpenLeadDays: leadRaw === '' ? null : leadRaw,
    selfCancelEnabled: formData.get('selfCancelEnabled') === 'on',
    cancelCutoffHours: cutoffRaw === '' ? null : cutoffRaw,
    noshowPenalty: formData.get('noshowPenalty'),
    multisportMode: formData.get('multisportMode'),
    multisportEnabled: formData.get('multisportEnabled') === 'on',
    openOnHolidays: formData.get('openOnHolidays') === 'on',
    waitlistCapacity: waitlistRaw === '' ? null : waitlistRaw,
  });
  if (!parsed.success) return { status: 'error', cause: 'invalid_input' };
  const result = await updateSchedulingSettings(db, club.id, parsed.data);
  if (!result.ok) return { status: 'error', cause: 'invalid_lead' };
  revalidatePath(`/s/${slug}/manage/policies`);
  revalidatePath(`/s/${slug}/manage`);
  return { status: 'ok' };
}
