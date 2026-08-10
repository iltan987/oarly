// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useActionState } from 'react';
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

import { AccountForm, type AccountProfile, GENDER_LABEL_KEYS, PAYMENT_LABEL_KEYS } from './account-form';
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

/**
 * A refusal that echoes back what was actually submitted, exactly as `saveAccountAction`
 * does. The echo is what the component re-seeds its inputs from, so a mock that returned a
 * bare `{ ok: false, reason }` would be testing a contract the action does not have.
 * The action's own half of it is pinned in `actions.test.ts`.
 */
function refuseEchoingSubmission(reason: 'invalid' | 'rate_limited', fields?: readonly string[]) {
  vi.mocked(saveAccountAction).mockImplementation(async (_prev, formData) => ({
    ok: false,
    reason,
    ...(fields ? { fields } : {}),
    values: {
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      birthday: String(formData.get('birthday') ?? ''),
      gender: String(formData.get('gender') ?? ''),
      defaultPaymentType: String(formData.get('defaultPaymentType') ?? ''),
    },
  }));
}

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

/**
 * Submit and wait for the action's result to be COMMITTED, not merely dispatched.
 *
 * The distinction is the whole reason this exists: an uncontrolled field already holds the
 * typed text the moment it is typed, so `waitFor(() => expect(field).toHaveValue('Ada'))`
 * passes before the action has even been called — it would go green with the fix removed
 * and only fail on timing. Wrapping the submit in an async `act` flushes the transition and
 * the resolved action inside it, so every assertion after it is about the settled form.
 */
async function submitAndSettle() {
  await act(async () => { submit(); });
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

/**
 * The gap this closes: every component test in this repo mocks `next-intl` with a key-echo,
 * so a key that does not exist in the catalogues renders its own name here and passes. It
 * fails in the browser as `MISSING_MESSAGE`, which nothing else in the suite can see —
 * `messages-parity.test.ts` compares the catalogues to EACH OTHER, not to the code.
 *
 * So: read the component's own source, take every literal `t('...')` it renders, and require
 * each one under `account.*` in every catalogue. Self-maintaining for this file — add a key
 * to the form without adding it to the messages and this fails.
 *
 * Two things it is brittle about, stated so a future failure reads correctly: a COMMENT in
 * account-form.tsx containing a literal `t('someKey')` would be scanned as if it were
 * rendered, and the `readFileSync` runs at collection time, so renaming or moving the
 * component fails this whole file with an ENOENT rather than a legible assertion.
 */
describe('AccountForm message keys', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/account/account-form.tsx'), 'utf8');
  const literalKeys = [...new Set([...source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
  // `t(GENDER_LABEL_KEYS[g])` / `t(PAYMENT_LABEL_KEYS[p])` are computed, so the maps
  // themselves are the source of those keys.
  const computedKeys = [...Object.values(GENDER_LABEL_KEYS), ...Object.values(PAYMENT_LABEL_KEYS)];

  it('renders at least the keys this file is about', () => {
    // Guards the regex itself: an expression that matched nothing would make the loop below
    // vacuous and the whole check would pass with the catalogue empty.
    expect(literalKeys).toEqual(expect.arrayContaining(['errorInvalid', 'errorFieldInvalid', 'saved']));
  });

  it.each(['tr', 'en'])('resolves every key it renders in %s.json', (locale) => {
    const messages = JSON.parse(
      readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf8'),
    ) as { account: Record<string, string> };
    const missing = [...literalKeys, ...computedKeys].filter((key) => !(key in messages.account));
    expect(missing, `account.* keys used by account-form.tsx but missing from ${locale}.json`)
      .toEqual([]);
  });
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
    refuseEchoingSubmission('rate_limited');
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('errorTooManyRequests');
    expect(toast.error).not.toHaveBeenCalledWith('errorInvalid');
    unmount();

    vi.clearAllMocks();
    refuseEchoingSubmission('invalid');
    render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('errorInvalid');
    expect(toast.error).not.toHaveBeenCalledWith('errorTooManyRequests');
  });

  // A rate-limited caller's fields are fine, so no inline field error may appear — the
  // inline error belongs to `invalid` alone.
  it('shows the inline error for invalid only, never for rate_limited', async () => {
    refuseEchoingSubmission('rate_limited');
    const { unmount } = render(<AccountForm profile={PROFILE} />);
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    vi.clearAllMocks();
    refuseEchoingSubmission('invalid');
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

  // ---- a refusal must not discard what the member typed ---------------------------------

  /**
   * The premise, pinned on its own so a failure here reads as "React changed" rather than
   * "the account form broke": React 19 resets an UNCONTROLLED form after any completed form
   * action, refusal included. A bare `<input defaultValue>` and a bare `<form action>` —
   * none of this repo's primitives, none of its components — so what this measures is
   * React's behaviour, and it is the reason `AccountForm` and `ProfileForm` have to hand
   * the submitted values back at all. If this ever goes green-by-passing (React stops
   * resetting), the seeding below becomes belt-and-braces rather than load-bearing, and the
   * comments on both forms need revisiting.
   */
  it('React resets an uncontrolled form after a completed action (the premise)', async () => {
    const action = vi.fn(async () => null);
    function Bare() {
      const [, formAction] = useActionState<null, FormData>(action, null);
      return (
        <form action={formAction}>
          <input aria-label="bare" name="bare" defaultValue="stored" />
          <button type="submit">go</button>
        </form>
      );
    }
    render(<Bare />);

    fireEvent.change(screen.getByLabelText('bare'), { target: { value: 'typed' } });
    expect(screen.getByLabelText('bare')).toHaveValue('typed');

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('bare')).toHaveValue('stored'));
  });

  /**
   * …and the fix for it. A refused save hands the submitted values back
   * (`AccountActionResult.values`), and the form re-renders with them as the inputs' new
   * `defaultValue`s. React writes a changed `defaultValue` to the input's value ATTRIBUTE
   * during the mutation phase, and the reset above runs at the end of that same commit, so
   * it restores the submitted value rather than the stored one. Nothing remounts.
   *
   * Remove the echo and React's reset wins: 'Ada' becomes 'İltan' again and this fails.
   */
  it('keeps the member\'s edits after a refusal, ready to retry', async () => {
    refuseEchoingSubmission('invalid');
    render(<AccountForm profile={{ ...PROFILE, birthday: '1990-04-17', gender: 'female' }} />);

    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '5559998877' } });
    await submitAndSettle();

    expect(toast.error).toHaveBeenCalledWith('errorInvalid');
    expect(screen.getByLabelText('firstName')).toHaveValue('Ada');
    expect(screen.getByLabelText('phone')).toHaveValue('5559998877');
    // Untouched fields keep the stored answers, which are also what was submitted.
    expect(screen.getByLabelText('lastName')).toHaveValue('Caner');
    expect(screen.getByLabelText('birthday')).toHaveValue('1990-04-17');
    expect(screen.getByRole('combobox', { name: 'gender' })).toHaveTextContent('genderFemale');
  });

  /**
   * A SECOND consecutive refusal has to keep the SECOND edit. `useActionState` hands back a
   * fresh result object each time, so the new values become the new `defaultValue`s and the
   * reset that follows restores those — the first refusal's echo must not stick.
   */
  it('keeps the edits across a second consecutive refusal', async () => {
    refuseEchoingSubmission('invalid');
    render(<AccountForm profile={PROFILE} />);

    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Ada' } });
    await submitAndSettle();
    expect(screen.getByLabelText('firstName')).toHaveValue('Ada');

    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Ada Lovelace' } });
    await submitAndSettle();
    expect(saveAccountAction).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('firstName')).toHaveValue('Ada Lovelace');
  });

  /**
   * The form must NOT remount on a refusal, and this is the assertion that says so.
   *
   * Remounting would also preserve the text — it was the first shape of this fix — but it
   * destroys the focused node: measured in Chrome, `document.activeElement` went from the
   * edited field to `<body>`, so a keyboard or screen-reader user was thrown to the top of
   * the document on every retry. Re-rendering with new `defaultValue`s costs a Base UI
   * DEV-ONLY warning instead (`@base-ui/utils/useControlled.js:25` guards it with
   * `process.env.NODE_ENV !== 'production'`), which is the cheaper of the two.
   */
  it('keeps the same form node on a refusal, so focus is not thrown away', async () => {
    refuseEchoingSubmission('invalid');
    const { container } = render(<AccountForm profile={PROFILE} />);
    const before = container.querySelector('form');
    const field = screen.getByLabelText('firstName');

    fireEvent.change(field, { target: { value: 'Ada' } });
    await submitAndSettle();

    expect(screen.getByLabelText('firstName')).toHaveValue('Ada');
    expect(container.querySelector('form')).toBe(before);
    expect(screen.getByLabelText('firstName')).toBe(field);
  });

  /**
   * The refusal has to say WHICH field, not only that something is wrong. The case that
   * makes this more than polish: a member whose stored name predates `signUpSchema`'s
   * length bounds cannot save at all — `maxLength` does not truncate an already-too-long
   * value — and a form-level "check the fields" never tells them where to look.
   */
  it('marks the fields the server objected to, and only those', async () => {
    refuseEchoingSubmission('invalid', ['firstName']);
    render(<AccountForm profile={PROFILE} />);

    await submitAndSettle();

    expect(screen.getByLabelText('firstName')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('lastName')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('phone')).not.toHaveAttribute('aria-invalid', 'true');
    // The named field carries its own message, alongside the form-level summary.
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toContain('errorFieldInvalid');
    expect(alerts).toContain('errorInvalid');
  });

  /**
   * The two closed sets are marked as well, and this is the case that says so. They cannot be
   * mistyped, so a refusal naming one means a crafted payload — but leaving them unmarked
   * would reproduce exactly the "check the fields, which one?" this change removed, since
   * `state.fields` carries every zod path including theirs.
   */
  it.each(['gender', 'defaultPaymentType'])('marks the closed-set control %s when named', async (field) => {
    refuseEchoingSubmission('invalid', [field]);
    render(<AccountForm profile={PROFILE} />);

    await submitAndSettle();

    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toContain('errorFieldInvalid');
    // …and the control still offers a usable answer rather than a blank, because the echo
    // falls back to the stored value for a member of neither set.
    expect(screen.getByRole('combobox', { name: 'gender' })).toHaveTextContent('genderUnset');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  // A rate-limited refusal names no field: the member's fields are fine.
  it('marks no field when the refusal is a rate limit', async () => {
    refuseEchoingSubmission('rate_limited');
    render(<AccountForm profile={PROFILE} />);

    await submitAndSettle();

    expect(screen.getByLabelText('firstName')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * The rate-limited refusal too — its values never reach the parse, so they are read
   * before the limiter in the action. A member who waits out the limit must not have to
   * retype what they had already typed.
   */
  it('keeps the member\'s edits after a rate-limited refusal', async () => {
    refuseEchoingSubmission('rate_limited');
    render(<AccountForm profile={PROFILE} />);

    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Byron' } });
    await submitAndSettle();

    expect(toast.error).toHaveBeenCalledWith('errorTooManyRequests');
    expect(screen.getByLabelText('lastName')).toHaveValue('Byron');
  });

  /**
   * The success path is unchanged and must stay that way: a save that persists revalidates,
   * `updatedAt` moves, and the form re-seeds from the STORED row — not from a stale
   * `state.values` left over from an earlier refusal.
   */
  it('re-seeds from the stored row after a success that follows a refusal', async () => {
    refuseEchoingSubmission('invalid');
    const { rerender } = render(<AccountForm profile={PROFILE} />);

    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Ada' } });
    await submitAndSettle();
    expect(screen.getByLabelText('firstName')).toHaveValue('Ada');

    vi.mocked(saveAccountAction).mockResolvedValue({ ok: true });
    await submitAndSettle();
    expect(toast.success).toHaveBeenCalledTimes(1);
    // The revalidated render: the row was saved under a corrected name.
    rerender(<AccountForm profile={{ ...PROFILE, firstName: 'Ada', updatedAt: new Date('2026-08-01T10:05:00Z') }} />);
    expect(screen.getByLabelText('firstName')).toHaveValue('Ada');
    expect(screen.getByLabelText('lastName')).toHaveValue('Caner');
  });
});
