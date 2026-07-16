// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
