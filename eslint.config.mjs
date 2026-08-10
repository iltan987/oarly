import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import vitest from "@vitest/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Type-aware linting + import hygiene for our TypeScript source.
  // projectService pulls type info from the nearest tsconfig (which includes
  // all **/*.ts(x) and **/*.mts); .js/.mjs/.cjs are excluded below.
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@stylistic": stylistic,
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
    rules: {
      // Import ordering (auto-fixable). Side-effect imports keep their position.
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      // simple-import-sort reorders specifiers but leaves whitespace alone; this
      // normalizes the comma spacing it produces (no Prettier in this project).
      "@stylistic/comma-spacing": "error",

      // Unused imports/vars: unused-imports auto-removes dead imports; the
      // typescript-eslint rule is disabled so this plugin owns the concern.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],

      // Type-only imports become `import type` (auto-fixable).
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      "@typescript-eslint/no-import-type-side-effects": "error",

      // Curated type-checked rules — high signal for our async/DB-heavy code.
      // (Deliberately NOT the full recommendedTypeChecked: its no-unsafe-*
      // family is mostly noise against Drizzle/Better-Auth external `any`s.)
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",

      // `<Button render={<Link/>}>` logs a Base UI dev-console error on every render
      // (`nativeButton` defaults to true and a `<Link>` isn't a `<button>`), and its
      // documented "fix" — `nativeButton={false}` — is worse: it stamps `role="button"`
      // onto an anchor that navigates, dropping it out of a screen reader's links list.
      // `app/s/[slug]/(member)/bookings/bookings-list.tsx`, `app/admin/page.tsx` and
      // `app/admin/audit/page.tsx` carry the full history; the last five leftover call
      // sites were converted rather than warned about, because the two rendered
      // identically enough that a test asserting only `getByRole('link')` and the href
      // could not tell them apart — this rule is the mechanical guard a sixth site
      // needed. Use `buttonVariants({ size, variant })` as the `<Link>`'s className
      // instead; it needs no Base UI component at all, so there is nothing to warn.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='render'] JSXOpeningElement[name.name='Link']",
          message: "Don't render a <Link> through Button's `render` prop — Base UI logs a dev-console error, and `nativeButton={false}` trades it for a real accessibility regression. Use buttonVariants({ size, variant }) as the <Link>'s className instead.",
        },
      ],
    },
  },

  // shadcn CLI-generated primitives: we never hand-author these (see the ui/
  // hands-off rule), so don't enforce our import-sort ordering on them —
  // `shadcn add` output would otherwise need an eslint --fix pass every time.
  {
    files: ["src/components/ui/**"],
    rules: {
      "simple-import-sort/imports": "off",
      "simple-import-sort/exports": "off",
      // The CLI itself emits `import { type X } from "…"` (see toggle-group.tsx),
      // which this rule flags as a side-effect import left behind by isolatedModules
      // transpilation. Same hands-off reasoning as the import-sort rules above: we
      // cannot hand-fix CLI output, so the rule is off for this directory instead.
      "@typescript-eslint/no-import-type-side-effects": "off",
    },
  },

  // Vitest rules for test files.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.integration.test.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
    },
  },

  // Config / plain-JS files: not part of the TS program, so no type-aware parsing.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // `.claude/worktrees/**` holds agent worktrees — full second checkouts nested inside
  // the repo. Without this, a repo-wide lint walks them and reports their copy of
  // `src/components/ui/*`, which the per-directory rules below only exempt at the
  // real path.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/worktrees/**"]),
]);

export default eslintConfig;
