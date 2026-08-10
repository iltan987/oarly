'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { updateSchedulingSettings } from '@/lib/scheduling-settings';
import { schedulingSettingsSchema } from '@/lib/schemas';

/**
 * The two fields this form leaves UNCONTROLLED (`defaultValue`), which are therefore the two
 * React 19's post-action form reset can destroy. Everything else here is React state — a
 * reset does not touch that.
 *
 * Echoed back on a refusal for the reason `manage/action-result.ts` sets out, and this form
 * is the case that shows why a field COUNT is the wrong test.
 *
 * The refusal reachable here is `invalid_input`: switch booking-open to "lead" mode and leave
 * the days blank, and `schedulingSettingsSchema`'s object-level refine rejects it — so this
 * returns before `updateSchedulingSettings` is ever called, and its own `invalid_lead` branch
 * is defence-in-depth that this form cannot reach. `invalid_input`'s message is the GENERIC
 * one; it names no field at all. And React's post-action reset also reverted
 * `waitlistCapacity`, which the owner may have changed in the same save. One field, silently,
 * with the error naming nothing.
 */
export type PoliciesFormValues = {
  bookingOpenLeadDays: string;
  waitlistCapacity: string;
};

export type PoliciesState =
  | { status: 'idle' }
  /** `convertedBoats` is the number of MultiSport-only boats this save turned into
   *  cash-only (spec §5.2) — the page's pre-save estimate is read at render time and
   *  can be stale, so the form reports THIS count back to the owner. */
  | { status: 'ok'; convertedBoats: number }
  | { status: 'error'; cause: 'invalid_lead' | 'invalid_input'; values: PoliciesFormValues };

export async function savePoliciesAction(slug: string, _prev: PoliciesState, formData: FormData): Promise<PoliciesState> {
  const { club, user } = await requireOwner(slug, '/manage/policies');
  const leadRaw = String(formData.get('bookingOpenLeadDays') ?? '').trim();
  const cutoffRaw = String(formData.get('cancelCutoffHours') ?? '').trim();
  const waitlistRaw = String(formData.get('waitlistCapacity') ?? '').trim();
  // Untrimmed, so a refusal hands the owner back the characters they have in front of them.
  const refuse = (cause: 'invalid_lead' | 'invalid_input'): PoliciesState => ({
    status: 'error',
    cause,
    values: {
      bookingOpenLeadDays: String(formData.get('bookingOpenLeadDays') ?? ''),
      waitlistCapacity: String(formData.get('waitlistCapacity') ?? ''),
    },
  });
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
  if (!parsed.success) return refuse('invalid_input');
  const result = await updateSchedulingSettings(db, club.id, parsed.data, user.id);
  if (!result.ok) return refuse('invalid_lead');
  revalidatePath(`/s/${slug}/manage/policies`);
  revalidatePath(`/s/${slug}/manage`);
  return { status: 'ok', convertedBoats: result.convertedBoats };
}
