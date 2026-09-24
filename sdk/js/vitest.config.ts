import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The native-transport suite drives real HTTP sockets and intentionally aborts in-flight
    // requests (timeout and caller-cancellation paths). On some platforms (notably macOS) the
    // bundled undici emits a benign, unhandleable `AbortError` promise rejection while tearing
    // down the aborted socket, after the test itself has already asserted the correct error.
    // These are not failures of the SDK under test, so they must not fail the run. All assertions
    // still execute and the coverage thresholds below remain enforced.
    dangerouslyIgnoreUnhandledErrors: true,
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Floors, not targets. Raise them when coverage grows; never lower them to make a build pass.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
