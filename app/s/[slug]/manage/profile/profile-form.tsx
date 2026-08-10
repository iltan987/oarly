'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { ManageActionResult } from '../action-result';
import { addSocialAction, type ProfileSaveResult, removeSocialAction, saveProfileAction } from './actions';
import { LogoUpload } from './logo-upload';

type Social = { id: string; platform: string; handle: string };
type Club = { name: string; tagline: string | null; description: string | null; phone: string | null; brandAccent: string | null; headingFont: 'default' | 'premium'; logoUrl: string | null; updatedAt: Date };

export function ProfileForm({ slug, club, socials }: { slug: string; club: Club; socials: Social[] }) {
  const t = useTranslations('manage.profile');
  const tm = useTranslations('manage');
  const [headingFont, setHeadingFont] = useState(club.headingFont);
  // The logo persists on its own (see LogoUpload) and its URL therefore has to outlive
  // every remount of the <form> below — including the refusal remount added for
  // `state.values`. Held here, in the component that never remounts, so a refused save
  // cannot silently roll the hidden `logoUrl` field back to a `club.logoUrl` that the
  // upload already superseded and no revalidation has refreshed.
  const [logoUrl, setLogoUrl] = useState(club.logoUrl ?? '');
  const [state, formAction] = useActionState<ProfileSaveResult | null, FormData>(saveProfileAction.bind(null, slug), null);

  // The toast lives here in the stable ProfileForm (the <form> below remounts on
  // save via its `key`, but this hook does not), so the success/failure toast
  // always fires.
  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('saved'));
    else toast.error(tm('actionError'));
  }, [state, t, tm]);

  // Remove-social state lives here in the stable parent, not per-row: a
  // successful remove revalidates and deletes that <li>, which would unmount a
  // row-local effect before its toast fires. This component survives the
  // removal, so the toast is reliable.
  const [rmState, rmAction] = useActionState<ManageActionResult | null, FormData>(removeSocialAction.bind(null, slug), null);
  const rmHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (rmState === null || rmState === rmHandled.current) return;
    rmHandled.current = rmState;
    if (rmState.ok) toast.success(t('socialRemoved'));
    else toast.error(tm('actionError'));
  }, [rmState, t, tm]);

  /*
   * The Base UI inputs below are uncontrolled — they seed their state from `defaultValue`
   * at mount. After a successful save, the server action refreshes this route and re-feeds
   * the just-saved values as new `defaultValue`s on the live inputs, which Base UI warns
   * about ("A component is changing the default value state of an uncontrolled input after
   * being initialized"). Keying the form remounts it with fresh defaults instead, and only
   * when something actually changed: `club.updatedAt` moves when the row is persisted,
   * never while typing.
   *
   * `state.attempt` is the second half of that key, and it is what keeps a REFUSED save
   * from throwing the owner's work away. React 19 resets an uncontrolled form after any
   * completed form action, success or failure — `<form action>` schedules the reset before
   * the action runs (react-dom 19.2.8, `startHostTransition` → `requestFormReset`), and it
   * lands as a native `.reset()` on the form node, so every field snaps back to its
   * `defaultValue`. Measured here in a browser: the same `<form>` node survived, a `reset`
   * event fired on it, and a 2001-character description became the stored two-character
   * one. A refusal does not revalidate, so `updatedAt` cannot move and cannot carry that
   * remount; `attempt` increments on every refusal instead, and the defaults it remounts
   * with are the values the owner just submitted (`state.values`), not the stored row.
   *
   * The same measurement on a SUCCESSFUL save is what separates the two mechanisms: there
   * the form node was REPLACED (the key moved) and the field showed the typed text because
   * the revalidation had re-fed it as the new stored value — the identical screen, a
   * different cause. Only the refusal case is this bug.
   */
  const rejected = state !== null && !state.ok ? state.values : null;
  const formKey = `${club.updatedAt.getTime()}:${state !== null && !state.ok ? state.attempt : 0}`;
  return (
    <div className="flex flex-col gap-6">
      <form key={formKey} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="headingFont" value={headingFont} />
        <LogoUpload slug={slug} url={logoUrl} onUrlChange={setLogoUrl} labels={{ logo: t('logo'), logoUpload: t('logoUpload'), logoUploading: t('logoUploading'), logoError: t('logoError'), logoRemove: t('logoRemove') }} />
        <Field>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" defaultValue={rejected?.name ?? club.name} required minLength={2} maxLength={80} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tagline">{t('tagline')}</FieldLabel>
          <Input id="tagline" name="tagline" defaultValue={rejected?.tagline ?? club.tagline ?? ''} maxLength={120} />
        </Field>
        <Field>
          <FieldLabel htmlFor="description">{t('description')}</FieldLabel>
          <textarea id="description" name="description" defaultValue={rejected?.description ?? club.description ?? ''} maxLength={2000} rows={4}
            className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs" />
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
          <Input id="phone" name="phone" type="tel" defaultValue={rejected?.phone ?? club.phone ?? ''} maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="brandAccent">{t('brandAccent')}</FieldLabel>
            <Input id="brandAccent" name="brandAccent" type="color" defaultValue={rejected?.brandAccent || club.brandAccent || '#0E9E93'} className="h-9 w-full" />
          </Field>
          <Field>
            <FieldLabel htmlFor="headingFont">{t('headingFont')}</FieldLabel>
            {/* `items` is what makes <SelectValue /> render the label, not the raw value. */}
            <Select items={{ default: t('fontDefault'), premium: t('fontPremium') }} value={headingFont} onValueChange={(v) => setHeadingFont(v as Club['headingFont'])}>
              <SelectTrigger id="headingFont">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('fontDefault')}</SelectItem>
                <SelectItem value="premium">{t('fontPremium')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <PendingButton className="self-start">{t('save')}</PendingButton>
      </form>

      <section className="flex flex-col gap-3">
        <h3 className="font-heading font-semibold">{t('socials')}</h3>
        {socials.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {socials.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 p-3 transition-opacity has-data-pending:opacity-40">
                <span className="min-w-0 truncate text-sm">{s.platform} · {s.handle}</span>
                <form action={rmAction} className="shrink-0">
                  <input type="hidden" name="socialId" value={s.id} />
                  <PendingButton size="sm" variant="ghost">{t('socialRemove')}</PendingButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AddSocialForm slug={slug} labels={{ platform: t('socialPlatform'), handle: t('socialHandle'), add: t('socialAdd') }} />
      </section>
    </div>
  );
}

function AddSocialForm({ slug, labels }: { slug: string; labels: { platform: string; handle: string; add: string } }) {
  const t = useTranslations('manage.profile');
  const tm = useTranslations('manage');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ManageActionResult | null, FormData>(addSocialAction.bind(null, slug), null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      toast.success(t('socialAdded'));
      formRef.current?.reset(); // clear the uncontrolled inputs after a successful add
    } else {
      toast.error(tm('actionError'));
    }
  }, [state, t, tm]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-2">
      <Field className="flex-1">
        <FieldLabel htmlFor="platform">{labels.platform}</FieldLabel>
        <Input id="platform" name="platform" placeholder="instagram" required maxLength={40} />
      </Field>
      <Field className="flex-1">
        <FieldLabel htmlFor="handle">{labels.handle}</FieldLabel>
        <Input id="handle" name="handle" placeholder="bebekrowing" required maxLength={80} />
      </Field>
      <PendingButton>{labels.add}</PendingButton>
    </form>
  );
}
