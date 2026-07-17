'use client';
import { upload } from '@vercel/blob/client';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function LogoUpload({ slug, initialUrl, labels }: {
  slug: string;
  initialUrl: string | null;
  labels: { logo: string; logoUpload: string; logoUploading: string; logoError: string; logoRemove: string };
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Persist immediately so the logo sticks without a separate profile Save.
  // Plain fetch (not a server action) avoids refreshing the route and remounting
  // the profile form, which would drop any unsaved text edits.
  async function persist(nextUrl: string) {
    const res = await fetch('/api/club-logo/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, url: nextUrl }),
    });
    if (!res.ok) throw new Error('save failed');
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const blob = await upload(`club-logos/${slug}/${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/club-logo/upload',
        clientPayload: slug,
      });
      await persist(blob.url);
      setUrl(blob.url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(false);
    try {
      await persist('');
      setUrl('');
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
        {/*
          Plain <label> wraps the file input instead of a Button+onClick proxy:
          the shadcn Button here wraps Base UI's Button, which has no `asChild`
          prop (Base UI uses a `render` prop instead), so the brief's
          `previousElementSibling`-click wiring doesn't type-check. A label
          styled with the same button classes gets native click-to-open-picker
          behavior for free with no extra JS.
        */}
        <label
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), busy && 'pointer-events-none opacity-50')}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={onChange}
            disabled={busy}
            className="hidden"
          />
          {busy ? labels.logoUploading : labels.logoUpload}
        </label>
        {url && !busy && (
          // type="button": this lives inside the profile <form>, so without it
          // a click would submit the form instead of removing the logo.
          <button
            type="button"
            onClick={onRemove}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            {labels.logoRemove}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{labels.logoError}</p>}
    </div>
  );
}
