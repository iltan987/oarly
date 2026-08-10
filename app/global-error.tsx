'use client';

/**
 * The last boundary. It catches what nothing else can: a throw in `app/layout.tsx` —
 * `getLocale()`, `ThemeProvider`, `NextIntlClientProvider` — because an `error.tsx` wraps
 * its segment's children and never the `layout.tsx` in its own segment. When it renders
 * it REPLACES the root layout, so it must supply its own `<html>` and `<body>`.
 *
 * ## Why this one file does not use next-intl, and must not be "fixed" to
 *
 * Every other string in this app goes through next-intl. This one cannot. The provider
 * lives in `app/layout.tsx`, which is exactly the thing that has failed by the time this
 * component mounts — `NextIntlClientProvider` is not in the tree, so `useTranslations`
 * would throw and the user would get Next's unstyled default instead of this page. A
 * boundary that can itself throw is not a boundary.
 *
 * So the copy is inline, in BOTH languages. That is not a shortcut around the i18n rule;
 * it is the one place the rule cannot hold, and showing both is the only honest answer
 * when the locale resolver is among the suspects. `app/global-error.test.tsx` renders
 * this with no provider mounted, so re-introducing `useTranslations` fails the suite
 * rather than only failing in production.
 *
 * ## Why it imports nothing at all
 *
 * Not `@/components/route-error` (it calls `useTranslations`), not `@/components/ui/*`,
 * not `./globals.css`. Every import is another module that can fail in the same way the
 * root layout just did, and this page's entire job is to still render when the rest of
 * the app did not. Hence inline styles rather than Tailwind classes, and CSS system
 * colors (`Canvas`/`CanvasText`) with `color-scheme: light dark` rather than the app's
 * theme tokens: next-themes writes the `dark` class onto the `<html>` that this file has
 * just replaced, so the app's theme genuinely cannot reach here — the system colors at
 * least follow the OS setting instead of pinning everyone to light.
 *
 * `lang="tr"` because Turkish is this app's default locale and leads the copy below; the
 * English paragraph carries its own `lang`.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="tr" style={{ colorScheme: 'light dark' }}>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '2rem',
          textAlign: 'center',
          background: 'Canvas',
          color: 'CanvasText',
          font: '1rem/1.5 system-ui, sans-serif',
        }}
      >
        <p style={{ margin: 0 }}>Bir şeyler ters gitti.</p>
        <p lang="en" style={{ margin: 0, opacity: 0.7 }}>Something went wrong.</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1rem',
            font: 'inherit',
            color: 'inherit',
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: '0.5rem',
            cursor: 'pointer',
          }}
        >
          Tekrar dene / Try again
        </button>
      </body>
    </html>
  );
}
