// @vitest-environment jsdom
/**
 * Runtime proof that `/account`'s error copy actually RESOLVES, through the real next-intl
 * machinery and the real catalogues — no key-echo mock anywhere in this file.
 *
 * `account-form.test.tsx` mocks `next-intl` (this repo's convention), so it can only show
 * WHICH key a control renders, never that the key exists. Its companion source-scan check
 * closes half the gap by requiring each key to be present in the JSON. This closes the other
 * half: presence in a file is not the same as resolution through `useTranslations`, and the
 * failure mode — next-intl renders the key itself and logs `MISSING_MESSAGE` rather than
 * throwing — is silent in every other test here.
 *
 * Deliberately narrow: the two error messages a refused save shows. The rest of the catalogue
 * is `messages-parity.test.ts`'s job.
 */
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const CATALOGUES = [['tr', tr], ['en', en]] as const;

/** The keys `account-form.tsx` renders when a save is refused. */
const REFUSAL_KEYS = ['errorInvalid', 'errorFieldInvalid', 'errorTooManyRequests'] as const;

function Message({ messageKey }: { messageKey: string }) {
  const t = useTranslations('account');
  return <span data-testid="msg">{t(messageKey)}</span>;
}

describe('account refusal copy', () => {
  it.each(CATALOGUES)('resolves every refusal message in %s, rather than echoing the key', (locale, messages) => {
    for (const key of REFUSAL_KEYS) {
      const { unmount } = render(
        // A fresh deep copy per render, as `handled-ref.test.tsx` does: an RSC payload
        // delivers the same catalogue by value and a different object by identity.
        <NextIntlClientProvider locale={locale} messages={structuredClone(messages)}>
          <Message messageKey={key} />
        </NextIntlClientProvider>,
      );
      const rendered = screen.getByTestId('msg').textContent;

      // The failure mode this exists for: next-intl renders `account.errorFieldInvalid`
      // — the key path — when the message is missing, and only logs. Asserting "not the
      // key path" is what distinguishes a resolved message from that fallback.
      expect(rendered, `${locale}.account.${key}`).not.toBe(`account.${key}`);
      expect(rendered, `${locale}.account.${key}`).not.toBe(key);
      expect(rendered?.trim().length, `${locale}.account.${key} is blank`).toBeGreaterThan(0);
      unmount();
    }
  });

  // The two locales must not accidentally share one string for the field-level and
  // form-level errors: they say different things and are shown in different places.
  it.each(CATALOGUES)('gives %s a distinct field-level and form-level message', (_locale, messages) => {
    expect(messages.account.errorFieldInvalid).not.toBe(messages.account.errorInvalid);
  });
});
