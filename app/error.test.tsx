// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import AuthError from './(auth)/error';
import AdminError from './admin/error';
import RootError from './error';
import RequestClubError from './request-club/error';
import MemberError from './s/[slug]/(member)/error';
import TenantError from './s/[slug]/error';
import ManageError from './s/[slug]/manage/error';

/**
 * Every route-level error boundary in the app, in one table.
 *
 * `error.tsx` files are Client Components taking `{ error, reset }`, so they are directly
 * renderable — no server-component dance, and no async component nested in a prop (the
 * trap that makes `render(await Layout())` return an empty div with no error).
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated plainly because it matters more than the green
 * tick. It proves each boundary renders the shared fallback with a working retry, and it
 * fails if a file is deleted or moved — but only because the import above stops
 * resolving, which is existence-checking, not behaviour. It CANNOT prove a boundary is in
 * the right POSITION: nothing here would notice if `app/error.tsx` were moved one segment
 * down, and position is the whole design (an `error.tsx` catches its segment's children,
 * never its own `layout.tsx`, so only a boundary above `app/s/[slug]/` can catch that
 * layout's `requireClub`). That, and the fact that `redirect()`/`notFound()` still pass
 * through rather than landing here, were verified by URL against a running server; see
 * this task's report.
 */
const BOUNDARIES: ReadonlyArray<[string, React.ComponentType<{ error: Error & { digest?: string }; reset: () => void }>]> = [
  ['app/error.tsx', RootError],
  ['app/(auth)/error.tsx', AuthError],
  ['app/request-club/error.tsx', RequestClubError],
  ['app/s/[slug]/error.tsx', TenantError],
  // The three that predate this task, in the same table so a change to `RouteError`
  // cannot quietly break them while the new ones stay green.
  ['app/admin/error.tsx', AdminError],
  ['app/s/[slug]/manage/error.tsx', ManageError],
  ['app/s/[slug]/(member)/error.tsx', MemberError],
];

describe.each(BOUNDARIES)('%s', (_path, Boundary) => {
  const error = Object.assign(new Error('boom'), { digest: 'abc123' });

  it('renders the shared failure message and a retry control', () => {
    render(<Boundary error={error} reset={() => {}} />);
    expect(screen.getByText('common.loadError')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
  });

  it('invokes reset when retry is pressed', () => {
    const reset = vi.fn();
    render(<Boundary error={error} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  /**
   * The `error` prop must not reach the user. It carries the raw message in development
   * and a digest in production, and this fallback is deliberately copy-only — a boundary
   * that started printing `error.message` would leak a server-side error string onto a
   * public club page.
   */
  it('shows the user neither the error message nor its digest', () => {
    const { container } = render(<Boundary error={error} reset={() => {}} />);
    expect(container.textContent).not.toContain('boom');
    expect(container.textContent).not.toContain('abc123');
  });
});
