import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// One config for the whole repository: vitest searches upward for it, so a `vitest run` in `libs/<name>`
// finds this file and resolves `root` to that package. `include` is therefore relative to whichever package
// is running, which is what keeps the application — the root package since plan 03 task 3 — from also
// collecting every library's tests and the Playwright specs under `e2e-tests/`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // `config/default.json` leaves `environmentName` empty so that an unset `ENVIRONMENT_NAME` fails the
    // persona switcher's allowlist closed rather than resolving to a permitted environment — see
    // `src/auth/persona-switcher.ts`. The suite is one of the two places that has to say which environment it
    // is, the other being `dev:app`; `test` is what `PERSONA_SWITCHER_ENVIRONMENTS` and
    // `SEEDED_PERSONA_ENVIRONMENTS` both name.
    env: { ENVIRONMENT_NAME: "test" },
    // `tsc -p tsconfig.app.json` excludes every test file, so a `@ts-expect-error` in one is checked by nothing.
    // A `*.test-d.ts` is run through `tsc` here instead. Absolute, since `root` is whichever package is running.
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
      tsconfig: fileURLToPath(new URL("./tsconfig.typecheck.json", import.meta.url))
    },
    coverage: {
      reporter: ["lcov", "text"],
      reportsDirectory: "coverage"
    }
  }
});
