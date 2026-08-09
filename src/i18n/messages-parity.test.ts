import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultLocale, type Locale, locales } from '@/i18n/config';

/**
 * Structural guard over the message catalogs. Turkish is the app default, so a key that
 * lands in `en.json` and not `tr.json` is a next-intl render-time throw for every real
 * user, on a page the team only ever reads in English.
 *
 * Two properties make this catch what component tests cannot, and both are load-bearing:
 *
 * 1. It reads the JSON off disk and compares the two catalogs to each other. Every other
 *    test in the suite mocks `next-intl`, so a one-sided key renders its own name and
 *    nothing fails.
 * 2. It names no keys. A checklist of "the keys this task added" only guards the task
 *    that wrote it; the next task has to remember to extend it, and will not. This
 *    compares key *sets*, so it covers keys nobody has written yet.
 *
 * It also has to live under `src/` — vitest's `include` is `src/**` plus `app/**`, so the
 * intuitive home for this file (`messages/parity.test.ts`) would never be collected, and
 * a guard that silently does not run is the same class of bug it exists to prevent.
 */

type MessageNode = string | { readonly [key: string]: MessageNode };
type Catalog = { readonly [key: string]: MessageNode };

function loadCatalog(locale: Locale): Catalog {
  const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`messages/${locale}.json is not a JSON object`);
  }
  return parsed as Catalog;
}

/** Every leaf path, dot-joined and sorted: the catalog's shape, independent of the copy. */
function keyPaths(node: Catalog, prefix = ''): string[] {
  return Object.entries(node)
    .flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string' ? [path] : keyPaths(value, path);
    })
    .sort();
}

/**
 * The argument names an ICU message references — the `name` in `{name}` and the `count`
 * in `{count, plural, ...}`.
 *
 * This is a real (small) ICU parser rather than a regex, and it has to be. A plural
 * message carries brace-delimited submessages of its own:
 *
 *     {count, plural, =0 {No members} one {# member} other {# members}}
 *
 * The obvious `/\{(\w+)/g` sweep reads `{No members}` as an argument named `No`. Turkish
 * has no `one` plural category, so its translation of that same key spells the zero case
 * differently and the two locales "disagree" on phantom argument names — four messages in
 * this catalog trip that sweep today, all of them correct. A checker that cries wolf on
 * correct input gets deleted, so it parses the grammar properly instead: a `{` opens an
 * argument only where an argument is legal, and submessage bodies are recursed into as
 * messages.
 */
function icuArguments(message: string): string[] {
  const names = new Set<string>();
  let i = 0;

  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i])) i += 1;
  };

  /** Reads `[^\s,{}]*` — an argument name or an argument type. */
  const readWord = () => {
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i])) i += 1;
    return message.slice(start, i);
  };

  /**
   * An apostrophe only escapes when it precedes `{`, `}` or `#`; `''` is a literal one.
   * Turkish copy is full of ordinary apostrophes ("MultiSport'u"), which must stay
   * ordinary or the parser loses its place mid-message.
   */
  const skipQuoted = () => {
    const next = message[i + 1];
    if (next === "'") {
      i += 2;
      return;
    }
    if (next !== '{' && next !== '}' && next !== '#') {
      i += 1;
      return;
    }
    i += 2;
    while (i < message.length && message[i] !== "'") i += 1;
    i += 1;
  };

  /** Text interleaved with arguments. When nested, stops at the submessage's `}`. */
  const parseMessage = (nested: boolean) => {
    while (i < message.length) {
      const char = message[i];
      if (char === '}') {
        if (nested) return;
        i += 1;
      } else if (char === '{') {
        parseArgument();
      } else if (char === "'") {
        skipQuoted();
      } else {
        i += 1;
      }
    }
  };

  function parseArgument() {
    i += 1; // '{'
    skipSpace();
    const name = readWord();
    skipSpace();

    if (message[i] === '}') {
      // `{name}` — a bare interpolation.
      if (name) names.add(name);
      i += 1;
      return;
    }
    if (message[i] !== ',') {
      // Not an argument after all (a stray brace in prose). Leave the rest to the
      // caller's text scan rather than guessing.
      return;
    }
    if (name) names.add(name);

    i += 1; // ','
    skipSpace();
    const type = readWord();
    skipSpace();

    if (message[i] === '}') {
      // `{count, number}` — typed, no style.
      i += 1;
      return;
    }
    if (message[i] !== ',') return;
    i += 1; // ','

    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      // `selector {submessage}` pairs. The submessages are messages: they can hold
      // further arguments, and `{No members}` in one is text, not an argument.
      while (i < message.length && message[i] !== '}') {
        if (message[i] === '{') {
          i += 1;
          parseMessage(true);
          i += 1; // the submessage's '}'
        } else {
          i += 1;
        }
      }
      i += 1; // the argument's '}'
      return;
    }

    // A simple style (`date, short`, `number, ::percent`): no submessages inside.
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === '{') depth += 1;
      else if (message[i] === '}') depth -= 1;
      i += 1;
    }
  }

  parseMessage(false);
  return [...names].sort();
}

/** Leaf path -> the ICU argument names that leaf references. */
function argumentsByPath(node: Catalog, prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = icuArguments(value);
    else Object.assign(out, argumentsByPath(value, path));
  }
  return out;
}

/** Leaf paths whose copy is blank — a key that exists but renders as nothing. */
function emptyPaths(node: Catalog, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return value.trim() === '' ? [path] : [];
    return emptyPaths(value, path);
  });
}

const catalogs = new Map<Locale, Catalog>(locales.map((l) => [l, loadCatalog(l)]));
const reference = catalogs.get(defaultLocale)!;
const referenceKeys = keyPaths(reference);
const otherLocales = locales.filter((l) => l !== defaultLocale);

describe('icuArguments', () => {
  // The catalog check is only as good as this parser, so pin the shapes it has to get
  // right — especially the plural submessage that defeats the regex version.
  it('reads a bare interpolation', () => {
    expect(icuArguments('Signed in as {email}')).toEqual(['email']);
  });
  it('reads the argument of a plural without inventing its submessages', () => {
    expect(icuArguments('{count, plural, =0 {No members} one {# member} other {# members}}'))
      .toEqual(['count']);
  });
  it('reads every argument of a message with two plurals', () => {
    expect(
      icuArguments('{members, plural, other {# members}} and {boats, plural, other {# boats}}'),
    ).toEqual(['boats', 'members']);
  });
  it('reads an argument nested inside a plural branch', () => {
    expect(icuArguments('{count, plural, other {# of {total}}}')).toEqual(['count', 'total']);
  });
  it('reads a typed argument with a style', () => {
    expect(icuArguments('due {when, date, short}')).toEqual(['when']);
  });
  it('treats an ordinary apostrophe as prose', () => {
    expect(icuArguments("MultiSport'u {count} kez")).toEqual(['count']);
  });
  it('treats a quoted brace as prose', () => {
    expect(icuArguments("use '{'literal'}' here with {name}")).toEqual(['name']);
  });
  it('finds nothing in a message with no arguments', () => {
    expect(icuArguments('Join this club')).toEqual([]);
  });
});

describe('message catalogs', () => {
  it('covers every configured locale', () => {
    expect([...catalogs.keys()].sort()).toEqual([...locales].sort());
  });

  describe.each(otherLocales)('%s against the default locale', (locale) => {
    const localeKeys = keyPaths(catalogs.get(locale)!);

    it(`defines every key ${defaultLocale}.json defines`, () => {
      const missing = referenceKeys.filter((key) => !localeKeys.includes(key));
      expect(missing, `key paths present in ${defaultLocale}.json but missing from ${locale}.json`)
        .toEqual([]);
    });

    it(`defines no key ${defaultLocale}.json is missing`, () => {
      const extra = localeKeys.filter((key) => !referenceKeys.includes(key));
      expect(extra, `key paths present in ${locale}.json but missing from ${defaultLocale}.json`)
        .toEqual([]);
    });

    it(`uses the same ICU arguments as ${defaultLocale}.json on every shared key`, () => {
      // An argument dropped in translation does not fail to compile and does not fail a
      // mocked component test; it throws when next-intl formats the message.
      const referenceArgs = argumentsByPath(reference);
      const localeArgs = argumentsByPath(catalogs.get(locale)!);
      const mismatches = Object.keys(referenceArgs)
        .filter((key) => key in localeArgs)
        .filter((key) => referenceArgs[key].join(',') !== localeArgs[key].join(','))
        .map((key) => ({
          key,
          [defaultLocale]: referenceArgs[key],
          [locale]: localeArgs[key],
        }));
      expect(mismatches).toEqual([]);
    });
  });

  it.each(locales)('%s.json has no blank message', (locale) => {
    expect(emptyPaths(catalogs.get(locale)!)).toEqual([]);
  });
});
