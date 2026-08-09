// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

// `useLocale` as well as `useTranslations`: a `vi.mock` factory REPLACES the whole
// module, so any component pulled into this tree that reaches for another next-intl hook
// gets `undefined is not a function` rather than a missing translation. Keep this factory
// in step with `language-toggle.test.tsx`'s.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'tr',
}));

describe('ThemeToggle', () => {
  it('renders a theme toggle button inside the provider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('toggleTheme')).toBeDefined();
  });

  it('flips the document theme class when clicked', async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = await screen.findByLabelText('toggleTheme');

    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
