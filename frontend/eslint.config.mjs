import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The UI is English-only, so numbers and dates name their locale: the
  // browser's would turn 1,232 into "1.232" (lib/format.ts). Tests may read
  // the browser's on purpose.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // x.toLocaleString(), toLocaleDateString(undefined, …), ([], …)
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.length=0]",
          message:
            "Name the locale: use formatNumber / formatDate / formatDateTime from '@/lib/format', or pass 'en-US'.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: "Name the locale: pass 'en-US' instead of undefined.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.type='ArrayExpression'][arguments.0.elements.length=0]",
          message: "Name the locale: pass 'en-US' instead of [].",
        },
        // new Intl.NumberFormat(), Intl.NumberFormat(undefined, …), new Intl.Collator([]).
        // A formatter with no arguments only to read its resolvedOptions() (the
        // browser's time zone, lib/timeZone.ts) formats nothing, with or without `new`.
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][arguments.length=0]:not(MemberExpression[property.name='resolvedOptions'] > .object)",
          message: "Name the locale: pass 'en-US'.",
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: "Name the locale: pass 'en-US' instead of undefined.",
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][arguments.0.type='ArrayExpression'][arguments.0.elements.length=0]",
          message: "Name the locale: pass 'en-US' instead of [].",
        },
      ],
    },
  },
  // Disable ESLint rules that conflict with Prettier — keep ESLint for code
  // quality and let Prettier own formatting. Must come last.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
