// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Key-echo translations, this repo's component-test convention: the words are covered by
// src/i18n/messages-parity.test.ts, and what matters here is which control is which.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({
  saveProfileAction: vi.fn(),
  addSocialAction: vi.fn(),
  removeSocialAction: vi.fn(),
}));

/**
 * A stub for the real `LogoUpload`, which pulls in `@vercel/blob/client` and talks to
 * `/api/club-logo/upload`. It reproduces the two properties this file depends on: a hidden
 * `logoUrl` field, and LOCAL state seeded once from `initialUrl` — which is what makes the
 * "no remount" assertion meaningful, since a remount is exactly what would re-seed it.
 */
vi.mock('./logo-upload', () => ({
  LogoUpload: ({ initialUrl }: { initialUrl: string | null }) => {
    const [url, setUrl] = React.useState(initialUrl ?? '');
    return (
      <>
        <input type="hidden" name="logoUrl" value={url} />
        <button type="button" onClick={() => setUrl('https://blob.example/new.png')}>
          fake-upload
        </button>
      </>
    );
  },
}));

import { toast } from 'sonner';

import { type ProfileSaveResult, saveProfileAction } from './actions';
import { ProfileForm } from './profile-form';

const CLUB = {
  name: 'Demo Kürek',
  tagline: 'sa',
  description: 'stored description',
  phone: '+905550001122',
  brandAccent: '#2563eb',
  headingFont: 'default' as const,
  logoUrl: 'https://blob.example/old.png',
  updatedAt: new Date('2026-08-01T10:00:00Z'),
};

/**
 * A refusal that echoes back what was actually submitted, exactly as `saveProfileAction`
 * does — the echo is what the form re-seeds from, so a mock returning a bare
 * `{ ok: false }` would be testing a contract the action does not have.
 */
function refuseEchoingSubmission() {
  vi.mocked(saveProfileAction).mockImplementation(async (_slug, _prev: ProfileSaveResult | null, formData: FormData) => ({
    ok: false as const,
    values: {
      name: String(formData.get('name') ?? ''),
      tagline: String(formData.get('tagline') ?? ''),
      description: String(formData.get('description') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      brandAccent: String(formData.get('brandAccent') ?? ''),
    },
  }));
}

/**
 * Submit and wait for the action's result to be COMMITTED, not merely dispatched.
 *
 * An uncontrolled field already holds the typed text the moment it is typed, so
 * `waitFor(() => expect(field).toHaveValue('rewritten'))` passes before the action has even
 * been called — it would go green with the fix removed and fail only on timing. The async
 * `act` flushes the transition and the resolved action inside it, so every assertion after
 * it is about the settled form.
 */
async function submitProfile() {
  await act(async () => {
    const form = document.querySelector('form');
    if (!form) throw new Error('profile form not found');
    fireEvent.submit(form);
  });
}

// `addSocialAction` / `removeSocialAction` are mounted but never driven here; the socials
// section has its own behaviour and is not what this file is about.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveProfileAction).mockResolvedValue({ ok: true });
});

afterEach(() => { vi.clearAllMocks(); });

describe('ProfileForm', () => {
  it('renders real DOM before anything else is asserted about it', () => {
    const { container } = render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByLabelText('description')).toHaveValue('stored description');
  });

  /**
   * The bug this file exists for. React 19 resets an uncontrolled form after ANY completed
   * form action (pinned as a premise in `app/account/account-form.test.tsx`), so before the
   * fix a refused save silently replaced a rewritten description with the stored one.
   *
   * The action now hands the submitted values back, and the form re-renders with them as the
   * inputs' new `defaultValue`s. React writes a changed `defaultValue` to the value ATTRIBUTE
   * during the mutation phase and the reset runs at the end of that same commit, so it
   * restores what the owner typed. Nothing remounts — see the focus test below for why that
   * matters.
   *
   * Remove the echo and this fails.
   */
  it('keeps the owner\'s edits after a refusal, ready to retry', async () => {
    refuseEchoingSubmission();
    render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);

    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'a long rewritten description' } });
    fireEvent.change(screen.getByLabelText('tagline'), { target: { value: 'new tagline' } });
    await submitProfile();

    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByLabelText('description')).toHaveValue('a long rewritten description');
    expect(screen.getByLabelText('tagline')).toHaveValue('new tagline');
    expect(screen.getByLabelText('name')).toHaveValue('Demo Kürek');
  });

  /**
   * A SECOND consecutive refusal has to keep the SECOND edit: `useActionState` hands back a
   * fresh result object each time, so the new values become the new `defaultValue`s and the
   * first refusal's echo must not stick.
   */
  it('keeps the edits across a second consecutive refusal', async () => {
    refuseEchoingSubmission();
    render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);

    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'first attempt' } });
    await submitProfile();
    expect(screen.getByLabelText('description')).toHaveValue('first attempt');

    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'second attempt' } });
    await submitProfile();
    expect(saveProfileAction).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('description')).toHaveValue('second attempt');
  });

  /**
   * The form must NOT remount on a refusal. Remounting also preserves the text — it was the
   * first shape of this fix — but it destroys the focused node: measured in Chrome,
   * `document.activeElement` went from the edited field to `<body>`, so a keyboard or
   * screen-reader user was thrown to the top of the document on every retry. Re-rendering
   * with new `defaultValue`s costs a Base UI DEV-ONLY warning instead
   * (`@base-ui/utils/useControlled.js:25` guards it with
   * `process.env.NODE_ENV !== 'production'`), which is the cheaper of the two.
   *
   * It also keeps `LogoUpload` mounted, which matters on its own: the logo persists through
   * its own endpoint without revalidating, so `club.logoUrl` is stale from the moment of an
   * upload, and a remount would seed the hidden field from it — silently rolling a
   * just-uploaded logo back, for the next successful save to write.
   */
  it('keeps the same form node on a refusal, so focus and the uploaded logo survive', async () => {
    refuseEchoingSubmission();
    const { container } = render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);
    const before = container.querySelector('form');
    const field = screen.getByLabelText('description');

    fireEvent.click(screen.getByText('fake-upload'));
    fireEvent.change(field, { target: { value: 'rewritten' } });
    await submitProfile();

    expect(screen.getByLabelText('description')).toHaveValue('rewritten');
    expect(container.querySelector('form')).toBe(before);
    expect(screen.getByLabelText('description')).toBe(field);
    expect(container.querySelector('input[name="logoUrl"]')).toHaveValue('https://blob.example/new.png');
  });

  /**
   * The success path is untouched: a persisted save revalidates, `updatedAt` moves, and the
   * form re-seeds from the STORED row rather than from a stale refusal echo.
   */
  it('re-seeds from the stored club after a success that follows a refusal', async () => {
    refuseEchoingSubmission();
    const { rerender } = render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);

    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'rewritten' } });
    await submitProfile();
    expect(screen.getByLabelText('description')).toHaveValue('rewritten');

    vi.mocked(saveProfileAction).mockResolvedValue({ ok: true });
    await submitProfile();
    expect(toast.success).toHaveBeenCalled();
    rerender(<ProfileForm slug="demo" club={{ ...CLUB, description: 'rewritten', updatedAt: new Date('2026-08-01T10:05:00Z') }} socials={[]} />);

    expect(screen.getByLabelText('description')).toHaveValue('rewritten');
    expect(screen.getByLabelText('tagline')).toHaveValue('sa');
  });
});
