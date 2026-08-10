// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
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
 * `/api/club-logo/upload`. What this file needs from it is only its CONTRACT — a hidden
 * `logoUrl` field plus an `onUrlChange` the parent owns — which is exactly the part the
 * "logo survives a refusal" test is about.
 */
vi.mock('./logo-upload', () => ({
  LogoUpload: ({ url, onUrlChange }: { url: string; onUrlChange: (u: string) => void }) => (
    <>
      <input type="hidden" name="logoUrl" value={url} />
      <button type="button" onClick={() => onUrlChange('https://blob.example/new.png')}>
        fake-upload
      </button>
    </>
  ),
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
  vi.mocked(saveProfileAction).mockImplementation(async (_slug, prev: ProfileSaveResult | null, formData: FormData) => ({
    ok: false as const,
    attempt: (prev !== null && !prev.ok ? prev.attempt : 0) + 1,
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
   * fix a refused save silently replaced a rewritten description with the stored one. The
   * action now hands the submitted values back and bumps `attempt`, which re-keys the form
   * so it remounts seeded with them.
   *
   * Remove either half — the echo or `attempt` in the key — and this fails.
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
   * The case a boolean "was refused" flag in the key would not survive: the key has to
   * change on EVERY refusal, or the second one does not remount and React's reset wins.
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
   * `attempt` in the form key, pinned by the mechanism rather than by the value: measured in
   * Chrome, the typed text survives a refusal even WITHOUT the remount, because React
   * updates an uncontrolled input's `defaultValue` attribute before it calls `.reset()`.
   * What does not survive is the console — that run logged "Base UI: A component is changing
   * the default value state of an uncontrolled FieldControl after being initialized", which
   * is the exact warning this form's remount key exists to avoid. Node identity rather than
   * a console spy, because Base UI dedupes each warning globally for the process.
   */
  it('remounts the form on a refusal rather than re-defaulting a live input', async () => {
    refuseEchoingSubmission();
    const { container } = render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);
    const before = container.querySelector('form');

    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'rewritten' } });
    await submitProfile();

    expect(screen.getByLabelText('description')).toHaveValue('rewritten');
    expect(container.querySelector('form')).not.toBe(before);
  });

  /**
   * A logo persists through its own endpoint WITHOUT revalidating the route, so `club.logoUrl`
   * is stale from that moment on. The refusal remount added above would therefore have rolled
   * the hidden field back to the old URL — and the next successful save would have written it.
   * The URL is held by `ProfileForm`, which never remounts, so it survives.
   */
  it('does not roll a just-uploaded logo back when a save is refused', async () => {
    refuseEchoingSubmission();
    const { container } = render(<ProfileForm slug="demo" club={CLUB} socials={[]} />);

    fireEvent.click(screen.getByText('fake-upload'));
    expect(container.querySelector('input[name="logoUrl"]')).toHaveValue('https://blob.example/new.png');

    await submitProfile();
    expect(toast.error).toHaveBeenCalled();
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
