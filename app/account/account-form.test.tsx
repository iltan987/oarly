// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Key-echo translations, per this repo's component-test convention. The words themselves
// are covered by src/i18n/messages-parity.test.ts; what matters here is WHICH key each
// control renders, since that is what distinguishes "not set" from "prefer not to say"
// and the rate-limited message from the generic one.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ saveAccountAction: vi.fn() }));

import { toast } from 'sonner';

import { accountProfileSchema } from '@/lib/schemas';

import { AccountForm, type AccountProfile } from './account-form';
import { type AccountActionResult, saveAccountAction } from './actions';

const PROFILE: AccountProfile = {
  email: 'member@example.com',
  firstName: 'İltan',
  lastName: 'Caner',
  phone: '5551112233',
  birthday: '',
  gender: '',
  defaultPaymentType: 'regular',
  updatedAt: new Date('2026-08-01T10:00:00Z'),
};

/**
 * Every deferred action promise handed to React, so `afterEach` can settle the ones a test
 * left hanging. An unresolved promise inside `useActionState` holds React's SHARED
 * transition lane, so the next test's submit never settles either — one honest failure
 * turns into a run of bogus ones that all point at the wrong thing.
 */
const undrained: ((result: AccountActionResult) => void)[] = [];

/** Hold the action unresolved and hand back its resolver. */
function deferAction(): (result: AccountActionResult) => void {
  let resolve!: (result: AccountActionResult) => void;
  const promise = new Promise<AccountActionResult>((r) => { resolve = r; });
  vi.mocked(saveAccountAction).mockReturnValueOnce(promise);
  undrained.push(resolve);
  return resolve;
}

function submit() {
  const form = document.querySelector('form');
  if (!form) throw new Error('form not found');
  fireEvent.submit(form);
}

/** The FormData React handed the action on the Nth submit. */
async function submittedFormData(call = 0): Promise<FormData> {
  await waitFor(() => expect(saveAccountAction).toHaveBeenCalledTimes(call + 1));
  return vi.mocked(saveAccountAction).mock.calls[call][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveAccountAction).mockResolvedValue({ ok: true });
});

afterEach(() => {
  for (const resolve of undrained.splice(0)) resolve({ ok: true });
});

describe('AccountForm', () => {
  it('renders real DOM before anything else is asserted about it', () => {
    // The empty-render hazard from app-brand.tsx, guarded at the top of the file rather
    // than trusted: everything below queries this tree, and an empty one would make the
    // negative assertions vacuously pass.
    const { container } = render(<AccountForm profile={PROFILE} />);
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByRole('button', { name: /save/ })).toBeInTheDocument();
  });

  // ---- gender: unset is not "prefer not to say" ---------------------------------------

  /**
   * The distinction the whole `''` design exists to keep. `gender` was NEVER collected at
   * sign-up, so every existing row is NULL, and a member who has not answered must not be
   * shown as having declined to answer — those are different facts, and fabricating one for
   * a special-category-adjacent field would be wrong under KVKK.
   *
   * Collapse the two in `account-form.tsx` (defaulting the Select to `prefer_not_to_say`,
   * or using that option as the placeholder) and this fails on both halves.
   */
  it('shows an unset gender as "not set", not as "prefer not to say"', () => {
    render(<AccountForm profile={PROFILE} />);

    const trigger = screen.getByRole('combobox', { name: 'gender' });
    expect(trigger).toHaveTextContent('genderUnset');
    expect(trigger).not.toHaveTextContent('genderPreferNotToSay');
  });

  it('shows an explicit prefer_not_to_say as itself, not as "not set"', () => {
    render(<AccountForm profile={{ ...PROFILE, gender: 'prefer_not_to_say' }} />);

    const trigger = screen.getByRole('combobox', { name: 'gender' });
    expect(trigger).toHaveTextContent('genderPreferNotToSay');
    expect(trigger).not.toHaveTextContent('genderUnset');
  });

  /**
   * …and the two render differently ALL THE WAY to the payload, not just in the trigger.
   * '' is what the action maps to NULL; `prefer_not_to_say` is what it stores verbatim. If
   * the "not set" option ever submitted the string `prefer_not_to_say`, both assertions
   * above would still pass and the database would quietly lose the distinction.
   */
  it('submits an unset gender as an empty string, and a chosen one as its value', async () => {
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    submit();
    expect((await submittedFormData()).get('gender')).toBe('');
    unmount();

    vi.clearAllMocks();
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: true });
    render(<AccountForm profile={{ ...PROFILE, gender: 'prefer_not_to_say' }} />);
    submit();
    expect((await submittedFormData()).get('gender')).toBe('prefer_not_to_say');
  });

  it('offers every gender the schema accepts, plus the "not set" entry', () => {
    render(<AccountForm profile={PROFILE} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'gender' }));

    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([
      'genderUnset', 'genderFemale', 'genderMale', 'genderOther', 'genderPreferNotToSay',
    ]);
  });

  // ---- birthday -----------------------------------------------------------------------

  /**
   * The silent-blank hazard, in the only place jsdom can see part of it: a NULL birthday
   * must render as an empty date field, and a set one must render populated. The other half
   * — that the page passes a STRING and not a Better-Auth `Date`, which `<input type="date">`
   * renders blank with no error — is only observable in a browser, and is checked there.
   */
  it('renders an unset birthday empty and a stored one populated', () => {
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    const empty = screen.getByLabelText('birthday');
    expect(empty).toHaveAttribute('type', 'date');
    expect(empty).toHaveValue('');
    unmount();

    render(<AccountForm profile={{ ...PROFILE, birthday: '1990-04-17' }} />);
    expect(screen.getByLabelText('birthday')).toHaveValue('1990-04-17');
  });

  it('submits an emptied birthday as an empty string, which the action clears to NULL', async () => {
    render(<AccountForm profile={{ ...PROFILE, birthday: '1990-04-17' }} />);
    fireEvent.change(screen.getByLabelText('birthday'), { target: { value: '' } });

    submit();
    expect((await submittedFormData()).get('birthday')).toBe('');
  });

  // ---- defaultPaymentType --------------------------------------------------------------

  // NOT NULL with a default, so there is nothing unset to represent and no such option.
  it('offers exactly the two payment types and never a "not set"', () => {
    render(<AccountForm profile={PROFILE} />);

    // Scoped to the radio group itself: `genderUnset` legitimately appears elsewhere on the
    // page (it is the Select's current value), so a document-wide "no not-set" assertion
    // would fail for the wrong reason — and, inverted, could pass for one too.
    const group = screen.getByRole('radiogroup');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(group).toHaveTextContent('paymentRegular');
    expect(group).toHaveTextContent('paymentMultisport');
    expect(group).not.toHaveTextContent('genderUnset');
  });

  it('submits the stored payment type', async () => {
    render(<AccountForm profile={PROFILE} />);
    submit();
    expect((await submittedFormData()).get('defaultPaymentType')).toBe('regular');
  });

  /**
   * A fresh render rather than a second submit on the one above, and the reason is the same
   * React 19 behaviour recorded on `AccountForm`: the form is RESET once an action
   * completes, so a click landing between submit #1 and its reset is undone again — which
   * made the combined version pass alone and fail in a full run. Two submits in one mounted
   * form is a race, not a test.
   */
  it('submits the newly picked payment type after a click', async () => {
    render(<AccountForm profile={PROFILE} />);
    fireEvent.click(screen.getByText('paymentMultisport'));

    submit();
    expect((await submittedFormData()).get('defaultPaymentType')).toBe('multisport');
  });

  // ---- email is not editable -----------------------------------------------------------

  /**
   * Changing an email needs re-verification through Better Auth's credential flow, so the
   * field must not merely LOOK disabled — it must carry no `name`, so nothing about it ever
   * reaches the action even from a hand-crafted submit through this form.
   */
  it('shows the email read-only and submits no email field at all', async () => {
    render(<AccountForm profile={PROFILE} />);

    const email = screen.getByLabelText('email');
    expect(email).toHaveValue('member@example.com');
    expect(email).toBeDisabled();
    expect(email).not.toHaveAttribute('name');

    submit();
    expect((await submittedFormData()).get('email')).toBeNull();
  });

  it('points at the existing password-reset route rather than growing a second one', () => {
    render(<AccountForm profile={PROFILE} />);
    expect(screen.getByRole('link', { name: 'passwordLink' })).toHaveAttribute('href', '/forgot-password');
  });

  // ---- the payload parses ---------------------------------------------------------------

  /**
   * Asserted against the REAL schema, the way policies-form.test.tsx does: a mocked action's
   * call args say nothing about whether the payload it WOULD have received actually parses.
   * This is what catches a renamed `name=` attribute, which no other assertion here would.
   */
  it('produces a payload the real accountProfileSchema accepts', async () => {
    render(<AccountForm profile={{ ...PROFILE, birthday: '1990-04-17', gender: 'female' }} />);
    submit();

    const fd = await submittedFormData();
    const parsed = accountProfileSchema.safeParse({
      firstName: String(fd.get('firstName') ?? '').trim(),
      lastName: String(fd.get('lastName') ?? '').trim(),
      phone: String(fd.get('phone') ?? '').trim(),
      birthday: String(fd.get('birthday') ?? '').trim(),
      gender: String(fd.get('gender') ?? '').trim(),
      defaultPaymentType: String(fd.get('defaultPaymentType') ?? '').trim(),
    });
    expect(parsed).toMatchObject({
      success: true,
      data: {
        firstName: 'İltan', lastName: 'Caner', phone: '5551112233',
        birthday: '1990-04-17', gender: 'female', defaultPaymentType: 'regular',
      },
    });
  });

  // ---- feedback -------------------------------------------------------------------------

  it('reports a successful save', async () => {
    render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('saved');
    expect(toast.error).not.toHaveBeenCalled();
  });

  /**
   * The two failure reasons must NOT share a message. "Check the fields" is actively
   * misleading advice to a member whose fields are fine and who simply has to wait — and
   * a single hardcoded error string passes any test that only checks one of the two, which
   * is why both are asserted here and each against the other's key.
   */
  it('gives the rate-limited refusal its own message, not the generic one', async () => {
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('errorTooManyRequests');
    expect(toast.error).not.toHaveBeenCalledWith('errorInvalid');
    unmount();

    vi.clearAllMocks();
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: false, reason: 'invalid' });
    render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('errorInvalid');
    expect(toast.error).not.toHaveBeenCalledWith('errorTooManyRequests');
  });

  // A rate-limited caller's fields are fine, so no inline field error may appear — the
  // inline error belongs to `invalid` alone.
  it('shows the inline error for invalid only, never for rate_limited', async () => {
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    vi.clearAllMocks();
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: false, reason: 'invalid' });
    render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('errorInvalid'));
  });

  /**
   * The remount hazard with its real timing, ported from policies-form.test.tsx. A save
   * revalidates the route, which bumps `user.updatedAt` ($onUpdate) and therefore the
   * `<form>`'s key — and that RSC payload lands together with the action's resolution, not
   * after it. Move `useActionState` or the toast effect inside the keyed `<form>` and the
   * remount destroys the hook awaiting the result: no toast at all.
   */
  it('still reports a save whose revalidation remounts the form mid-flight', async () => {
    const resolve = deferAction();
    const { rerender } = render(<AccountForm profile={PROFILE} />);

    submit();
    await waitFor(() => expect(saveAccountAction).toHaveBeenCalledTimes(1));

    // The revalidated render arrives first: new updatedAt, new key, fields remounted.
    const saved = { ...PROFILE, updatedAt: new Date('2026-08-01T10:05:00Z') };
    rerender(<AccountForm profile={saved} />);

    resolve({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('saved');

    // …and a further remount must not replay it.
    rerender(<AccountForm profile={{ ...saved, updatedAt: new Date('2026-08-01T10:06:00Z') }} />);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  /**
   * A refusal must leave the form showing the STORED profile, not a blank one.
   *
   * Written this way because the intuitive assertion — that the member's in-flight edit
   * survives — is FALSE, and was measured to be false rather than assumed either way:
   * React 19 resets an uncontrolled form after any completed form action, so 'Ada' is gone
   * whatever this component does (reproduced against a bare `<input defaultValue>` outside
   * this repo's primitives, so it is React's behaviour and not Base UI's). Asserting the
   * edit survives would fail; asserting nothing would leave the far worse outcome — a
   * refusal that blanks every field — unguarded. So this pins the recoverable state.
   */
  it('leaves the stored values in the form after a refusal, rather than blanking it', async () => {
    vi.mocked(saveAccountAction).mockResolvedValue({ ok: false, reason: 'invalid' });
    render(<AccountForm profile={{ ...PROFILE, birthday: '1990-04-17', gender: 'female' }} />);

    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Ada' } });
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('firstName')).toHaveValue('İltan');
    expect(screen.getByLabelText('phone')).toHaveValue('5551112233');
    expect(screen.getByLabelText('birthday')).toHaveValue('1990-04-17');
    expect(screen.getByRole('combobox', { name: 'gender' })).toHaveTextContent('genderFemale');
  });
});
