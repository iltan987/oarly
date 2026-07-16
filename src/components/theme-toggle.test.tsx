// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

describe('ThemeToggle', () => {
  it('renders a theme toggle button inside the provider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Toggle theme')).toBeDefined();
  });

  it('flips the document theme class when clicked', async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = await screen.findByLabelText('Toggle theme');

    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
