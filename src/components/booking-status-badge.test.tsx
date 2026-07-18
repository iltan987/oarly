// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusPill, toneByStatus } from '@/components/booking-status-badge';

describe('StatusPill', () => {
  it('maps each booking status to its intended tone', () => {
    expect(toneByStatus).toEqual({
      booked: 'accent',
      waitlisted: 'warn',
      attended: 'ok',
      no_show: 'bad',
      cancelled: 'neutral',
    });
  });

  it('renders the label with the tone classes for the given tone', () => {
    render(<StatusPill tone="warn">Waitlisted</StatusPill>);
    const el = screen.getByText('Waitlisted');
    expect(el.className).toContain('bg-warn-bg');
    expect(el.className).toContain('text-warn');
  });
});
