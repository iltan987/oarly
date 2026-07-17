'use client';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { addSocialAction, removeSocialAction, saveProfileAction } from './actions';
import { LogoUpload } from './logo-upload';

type Social = { id: string; platform: string; handle: string };
type Club = { name: string; tagline: string | null; description: string | null; phone: string | null; brandAccent: string | null; headingFont: 'default' | 'premium'; logoUrl: string | null; updatedAt: Date };

export function ProfileForm({ slug, club, socials }: { slug: string; club: Club; socials: Social[] }) {
  const t = useTranslations('manage.profile');
  // The Base UI inputs below are uncontrolled — they seed their state from
  // `defaultValue` at mount. After Save, the server action refreshes this
  // route and re-feeds the just-saved values as new `defaultValue`s on the
  // live inputs, which Base UI warns about. Keying the form on the club's
  // `updatedAt` remounts it with fresh defaults after each save (and only
  // then — the timestamp changes when the row is persisted, never while
  // typing), which is the intended "reset to saved state" behaviour.
  return (
    <div className="flex flex-col gap-6">
      <form key={club.updatedAt.getTime()} action={saveProfileAction.bind(null, slug)} className="flex flex-col gap-4">
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
