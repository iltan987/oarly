'use client';
import { upload } from '@vercel/blob/client';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * `url` is owned by `ProfileForm`, not by this component, because this component lives
 * INSIDE the keyed `<form>` and that form remounts on both a successful save and a refused
 * one. Local state here would be re-seeded from `club.logoUrl` on every remount — and
 * since an upload persists WITHOUT revalidating the route (see `persist` below), that prop
 * is stale by exactly the change the owner just made. The next save would then write the
 * old logo back. Holding it one level up, in the component that never remounts, is what
 * keeps the persisted logo and the hidden field agreeing.
 */
export function LogoUpload({ slug, url, onUrlChange, labels }: {
  slug: string;
  url: string;
  onUrlChange: (url: string) => void;
  labels: { logo: string; logoUpload: string; logoUploading: string; logoError: string; logoRemove: string };
}) {
  // Separate flags rather than one shared flag: with a single one an in-flight
  // upload also spins the Remove button, which reads as "removal in progress" when
  // nothing of the sort is happening. Both controls still DISABLE for either
  // operation — they write the same field — but only the one actually running spins.
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(false);

  // Persist immediately so the logo sticks without a separate profile Save.
  // Plain fetch (not a server action) avoids refreshing the route and remounting
  // the profile form, which would reset every uncontrolled field to its defaultValue.
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
    setUploading(true);
    setError(false);
    try {
      const blob = await upload(`club-logos/${slug}/${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/club-logo/upload',
        clientPayload: slug,
      });
      await persist(blob.url);
      onUrlChange(blob.url);
    } catch {
      setError(true);
    } finally {
      setUploading(false);
    }
  }

  async function onRemove() {
    setRemoving(true);
    setError(false);
    try {
      await persist('');
      onUrlChange('');
    } catch {
      setError(true);
    } finally {
      setRemoving(false);
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
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), (uploading || removing) && 'pointer-events-none opacity-50')}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onChange}
            disabled={uploading || removing}
            className="hidden"
          />
          {uploading ? labels.logoUploading : labels.logoUpload}
        </label>
        {url && (
          // type="button": this lives inside the profile <form>, so without it
          // a click would submit the form instead of removing the logo.
          // Stays mounted while removing (unlike a naive `{url && !removing}` guard)
          // so the pending signal is visible instead of the trigger vanishing mid-flight.
          <button
            type="button"
            onClick={onRemove}
            disabled={uploading || removing}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), (uploading || removing) && 'pointer-events-none opacity-50')}
          >
            {removing && <Spinner />}
            {labels.logoRemove}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{labels.logoError}</p>}
    </div>
  );
}
