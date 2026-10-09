/// <reference types="@vitest/browser/providers/playwright" />
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Component tests: `*.browser.test.tsx`, rendered by React into a real
 * headless Chromium (Vitest browser mode, Playwright provider). Real, not
 * jsdom, because what these tests exist for — focus and blur, keyboard
 * ordering, media elements, Web Audio — is exactly what a fake DOM gets wrong.
 *
 * A separate config, not a third project in vite.config.ts, so `vitest run`
 * (the node suite, sharded four ways on CI) never boots a browser. Run with
 * `pnpm run test:browser`; when to write one at all is in
 * docs/TESTING_STANDARDS.md.
 */
export default defineConfig({
  // Not vite.config.ts: no React Router plugin (it wants to own the app
  // entry). Tailwind is in, and browser-test-setup.ts imports the app's own
  // app.css, so utility classes apply exactly as in the app — a test can
  // assert layout behaviour (sticky, line-clamp, overflow) against the real
  // stylesheet instead of hand-written stand-in CSS.
  plugins: [tailwindcss(), tsconfigPaths()],
  // Pre-bundled up front. Discovering them mid-run makes Vite reload the page
  // under a running test, which reads as a flaky failure on a cold CI cache.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react-router",
      "vitest-browser-react",
      "vitest-browser-react/pure",
      "tldraw",
    ],
  },
  test: {
    name: "browser",
    include: ["app/**/*.browser.test.tsx"],
    setupFiles: ["./app/browser-test-setup.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }],
    },
  },
});
