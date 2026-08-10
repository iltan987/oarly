// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Key-echo translations, per this repo's component-test convention: this file asserts
// WHICH key each control renders. The words are the catalogs' business
// (`src/i18n/messages-parity.test.ts`, `src/i18n/tr-member-register.test.ts`).
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/auth-client', () => ({
  authClient: { signIn: { email: vi.fn(), social: vi.fn() } },
}));

import { SignInForm } from './sign-in-form';

function renderForm() {
  return render(<SignInForm title="signInTitle" redirectTo="/" />);
}

/**
 * The way OUT of this page, which is the half of it nothing else tests.
 *
 * `auth.noAccount` had no reader anywhere in the repo's history while its twin
 * `auth.haveAccount` had one on the sign-up page from the day that page shipped — the
 * asymmetry this file exists to hold. A key with no reader is invisible to
 * `messages-parity.test.ts`, which compares the two catalogs to EACH OTHER and so cannot
 * see a string that is dead in both; the only thing that keeps `noAccount` alive is a
 * test that fails when the reader goes away.
 */
describe('SignInForm: the way out', () => {
  it('offers the sign-up link with the prose that says what it is for', () => {
    renderForm();
    const toSignUp = screen.getByRole('link', { name: 'toSignUp' });
    expect(toSignUp).toHaveAttribute('href', '/sign-up');
    // The prose and the link are one sentence, so the question has to be in the same
    // element the link sits in — `noAccount` rendered somewhere else on the page would
    // satisfy a bare `getByText` and read as an orphan paragraph.
    expect(toSignUp.parentElement).toHaveTextContent('noAccount');
  });

  /**
   * And it is a LINK, not a Button rendering one. `/admin`'s create-club control shipped
   * as `<Button render={<Link/>} nativeButton={false}>`, which stamps `role="button"` onto
   * the `<a>` and takes it out of a screen reader's links list — the defect
   * `app/admin/page.test.tsx` caught with this same `getByRole('link')`.
   */
  it('keeps forgot-password beside it as a second, distinct destination', () => {
    renderForm();
    expect(screen.getByRole('link', { name: 'forgotLink' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
