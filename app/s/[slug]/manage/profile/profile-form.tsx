'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { addSocialAction, type ManageActionResult, removeSocialAction, saveProfileAction } from './actions';
import { LogoUpload } from './logo-upload';

type Social = { id: string; platform: string; handle: string };
type Club = { name: string; tagline: string | null; description: string | null; phone: string | null; brandAccent: string | null; headingFont: 'default' | 'premium'; logoUrl: string | null; updatedAt: Date };

export function ProfileForm({ slug, club, socials }: { slug: string; club: Club; socials: Social[] }) {
  const t = useTranslations('manage.profile');
  const tm = useTranslations('manage');
  const [headingFont, setHeadingFont] = useState(club.headingFont);
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(saveProfileAction.bind(null, slug), null);

  // The toast lives here in the stable ProfileForm (the <form> below remounts on
  // save via its `key`, but this hook does not), so the success/failure toast
  // always fires. A failed save returns { ok: false } WITHOUT revalidating, so
  // `club.updatedAt` is unchanged, the form does not remount, and the user's
  // edits are preserved to retry.
  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('saved'));
    else toast.error(tm('actionError'));
  }, [state, t, tm]);

  // The Base UI inputs below are uncontrolled — they seed their state from
  // `defaultValue` at mount. After a successful save, the server action refreshes
  // this route and re-feeds the just-saved values as new `defaultValue`s on the
  // live inputs, which Base UI warns about. Keying the form on the club's
  // `updatedAt` remounts it with fresh defaults after each save (and only
  // then — the timestamp changes when the row is persisted, never while
  // typing), which is the intended "reset to saved state" behaviour.
  return (
    <div className="flex flex-col gap-6">
      <form key={club.updatedAt.getTime()} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="headingFont" value={headingFont} />
        <LogoUpload slug={slug} initialUrl={club.logoUrl} labels={{ logo: t('logo'), logoUpload: t('logoUpload'), logoUploading: t('logoUploading'), logoError: t('logoError'), logoRemove: t('logoRemove') }} />
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
            <Select value={headingFont} onValueChange={(v) => setHeadingFont(v as Club['headingFont'])}>
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
        <Button type="submit" className="self-start" disabled={pending}>{t('save')}</Button>
      </form>

      <section className="flex flex-col gap-3">
        <h3 className="font-heading font-semibold">{t('socials')}</h3>
        {socials.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {socials.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-3">
                <span className="text-sm">{s.platform} · {s.handle}</span>
                <RemoveSocialForm slug={slug} socialId={s.id} label={t('socialRemove')} />
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
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(addSocialAction.bind(null, slug), null);

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
      <Button type="submit" disabled={pending}>{labels.add}</Button>
    </form>
  );
}

function RemoveSocialForm({ slug, socialId, label }: { slug: string; socialId: string; label: string }) {
  const t = useTranslations('manage.profile');
  const tm = useTranslations('manage');
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(removeSocialAction.bind(null, slug), null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('socialRemoved'));
    else toast.error(tm('actionError'));
  }, [state, t, tm]);

  return (
    <form action={formAction}>
      <input type="hidden" name="socialId" value={socialId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>{label}</Button>
    </form>
  );
}
