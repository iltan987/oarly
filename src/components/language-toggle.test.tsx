// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentLocale = 'tr';

// Key-echo translations, per this repo's component-test convention: this test is about
// which control renders and what it submits, not about copy. Copy is covered by
// src/i18n/messages-parity.test.ts.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => currentLocale,
}));

vi.mock('@/i18n/set-locale', () => ({ setLocale: vi.fn(async () => {}) }));

import { setLocale } from '@/i18n/set-locale';

import { LanguageToggle } from './language-toggle';

describe('LanguageToggle', () => {
  beforeEach(() => { vi.clearAllMocks(); currentLocale = 'tr'; });

  it('shows both languages, named so a speaker of either can find theirs', () => {
    // Autonyms, not translated names: a user who cannot read the current UI language
    // still has to be able to identify their own.
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'Türkçe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
  });

  it('marks the active language pressed and the other not', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'Türkçe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the other language on click', async () => {
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('en'));
  });

  it('does nothing when the already-active language is clicked', async () => {
    // Base UI's single-select ToggleGroup UNPRESSES the pressed item and reports `[]`.
    // A switcher has no "no language" state; a naive port of the Radix API sends
    // undefined to the server here.
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Türkçe' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('reflects the active language when it is English', () => {
    currentLocale = 'en';
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels the group for assistive technology', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('group', { name: 'language' })).toBeInTheDocument();
  });
});
