// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';

/**
 * The component holds no copy of its own, so there is no next-intl mock here and nothing
 * to assert about translation keys — every string in these tests is one the caller passed.
 * That absence IS the contract: if a default string ever appears in `empty-state.tsx`, it
 * would be untranslated English on a Turkish-default app, and the parity test would never
 * see it because it would have no key.
 */
describe('EmptyState', () => {
  it('renders the title, the body and the action', () => {
    render(<EmptyState title="No upcoming bookings" body="Browse the next few days." action={<a href="/book">Book a session</a>} />);

    expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
    expect(screen.getByText('Browse the next few days.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a session' })).toHaveAttribute('href', '/book');
  });

  /**
   * The Past section passes no action, because there is nothing a member can do to acquire
   * a past booking. Asserted as "no interactive node at all" rather than "the container has
   * one child fewer": a wrapper rendered empty would satisfy a child count just as well and
   * still leave the gap this omission exists to remove.
   */
  it('renders no action node when the caller passes none', () => {
    render(<EmptyState title="No past bookings" body="Sessions you've been to will collect here." />);

    expect(screen.getByText('No past bookings')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * `/book`'s day-with-no-sessions state passes a title and a hint and no action. A body of
   * `undefined` must not render an empty paragraph — the title would then sit above a blank
   * line that reads as copy failing to load.
   */
  it('renders no body paragraph when the caller passes none', () => {
    const { container } = render(<EmptyState title="No sessions this day" />);

    expect(screen.getByText('No sessions this day')).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
