// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminPagination } from './admin-pagination';

/**
 * This component is the one artefact the users list and the clubs list share, so its
 * URL contract is pinned here rather than rediscovered by each page: page 1 is the bare
 * path, empty filters never reach the query string, and the page number a caller passes
 * cannot produce a link to a page that does not exist.
 */
function setup(props: Partial<Parameters<typeof AdminPagination>[0]> = {}) {
  render(
    <AdminPagination
      basePath="/admin/users"
      query={{}}
      page={2}
      pageSize={25}
      total={100}
      prevLabel="Previous"
      nextLabel="Next"
      rangeLabel="26-50 of 100"
      {...props}
    />,
  );
}

const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

describe('AdminPagination', () => {
  // Rendering "Previous / 1-3 of 3 / Next" under a list that is entirely on screen is
  // navigation that goes nowhere.
  it.each([
    ['the list fits on one page', 25],
    ['the list is short', 3],
    ['the list is empty', 0],
  ] as const)('renders nothing when %s', (_label, total) => {
    const { container } = render(
      <AdminPagination basePath="/admin/users" query={{}} page={1} pageSize={25} total={total}
        prevLabel="Previous" nextLabel="Next" rangeLabel="range" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders both directions and the range in the middle of the list', () => {
    setup();
    expect(hrefOf('Previous')).toBe('/admin/users');
    expect(hrefOf('Next')).toBe('/admin/users?page=3');
    expect(screen.getByText('26-50 of 100')).toBeInTheDocument();
  });

  // `?page=1` and no `page` are the same list; two URLs for one page is how a shared
  // link and a bookmark stop matching.
  it('links back to page 1 as the bare path, with no page parameter', () => {
    setup({ page: 2, query: {} });
    const url = new URL(hrefOf('Previous') ?? '', 'http://x');
    expect(url.pathname).toBe('/admin/users');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('carries the filters across a page change and drops the empty ones', () => {
    setup({ query: { q: 'ada', status: undefined, note: '' } });
    const url = new URL(hrefOf('Next') ?? '', 'http://x');
    expect(url.searchParams.get('q')).toBe('ada');
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('note')).toBe(false);
    expect(url.searchParams.get('page')).toBe('3');
  });

  it('keeps the filters on the link back to page 1', () => {
    setup({ page: 2, query: { q: 'ada' } });
    expect(hrefOf('Previous')).toBe('/admin/users?q=ada');
  });

  it('offers no Previous on the first page and no Next on the last', () => {
    setup({ page: 1 });
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Next' })).toBeInTheDocument();
    screen.getByText('26-50 of 100');
  });

  it('offers no Next on the last page', () => {
    setup({ page: 4 });
    expect(screen.getByRole('link', { name: 'Previous' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  });

  // An out-of-range page must not produce a Previous link into another empty page,
  // with another Previous link behind that one.
  it('clamps a page beyond the end to the last page that exists', () => {
    setup({ page: 999 });
    expect(hrefOf('Previous')).toBe('/admin/users?page=3');
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  });

  it('clamps a page below the start to page 1', () => {
    setup({ page: 0 });
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(hrefOf('Next')).toBe('/admin/users?page=2');
  });

  it('never puts a fraction in a page link', () => {
    setup({ page: 2.5 });
    expect(hrefOf('Next')).toBe('/admin/users?page=3');
    expect(hrefOf('Previous')).toBe('/admin/users');
  });
});
