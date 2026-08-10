// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Echoes the NAMESPACE as well as the key. The usual `(key) => key` mock in this repo
// throws the namespace away, and the namespace is the entire subject of the first test
// below: `useTranslations('booking')` and `useTranslations('common')` are indistinguishable
// under a key-only mock.
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

// Imported, not read off disk with `fileURLToPath(import.meta.url)` the way
// `messages-parity.test.ts` does it: under `@vitest-environment jsdom` `import.meta.url`
// is an http URL, and that resolves to a bare `/messages/en.json` that does not exist.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { RouteError } from './route-error';

type Catalog = Record<string, Record<string, unknown>>;

const CATALOGS: ReadonlyArray<[string, Catalog]> = [
  ['tr', tr as Catalog],
  ['en', en as Catalog],
];

describe('RouteError', () => {
  it('renders the failure message and a retry control', () => {
    render(<RouteError retry={() => {}} />);
    expect(screen.getByText('common.loadError')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
  });

  it('invokes retry when the retry control is pressed', () => {
    const retry = vi.fn();
    render(<RouteError retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  /**
   * The namespace, pinned. Both assertions are needed and neither is redundant:
   *
   * - The rendered text kills a component pointed back at `booking`.
   * - The catalog assertions kill a MOVE THAT ONLY HALF HAPPENED — keys copied into
   *   `common` but left behind in `booking`. `messages-parity.test.ts` compares the two
   *   locales to each other and so cannot see a key that is dead in both, which is
   *   exactly what an orphan is.
   *
   * A wrong namespace never throws: next-intl renders the literal key path, so the page
   * would ship reading "common.loadError" to a real user with nothing else failing.
   */
  it.each(CATALOGS)('reads its copy from the common namespace in %s', (_locale, catalog) => {
    expect(catalog.common).toHaveProperty('loadError');
    expect(catalog.common).toHaveProperty('retry');
    expect(catalog.booking).not.toHaveProperty('loadError');
    expect(catalog.booking).not.toHaveProperty('retry');
  });
});
