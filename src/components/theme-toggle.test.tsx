// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

beforeAll(() => {
  // jsdom does not implement matchMedia; next-themes' `enableSystem` path needs it.
  window.matchMedia =
    window.matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
});

describe('ThemeToggle', () => {
  it('renders a theme toggle button inside the provider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Toggle theme')).toBeDefined();
  });
});
