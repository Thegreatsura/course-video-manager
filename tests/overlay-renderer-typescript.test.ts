import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The overlay renderer (`packages/overlay-renderer`, Remotion) is filtered out
 * of every root check, so nothing else here would notice it breaking.
 *
 * `@remotion/bundler`'s esbuild loader does `require("typescript")` and calls
 * `typescript.sys.readFile` — the classic JS compiler API. It does not declare
 * TypeScript as a dependency, so it used to pick up the workspace root's
 * `typescript`, which is TS 7 (the native port, no `sys`). Every overlay render
 * then died with "Cannot read properties of undefined (reading 'readFile')":
 * Shorts' subtitles, and Definition Cards on export.
 *
 * The root `package.json` gives it a JS-API TypeScript via
 * `pnpm.packageExtensions`. This asserts that is what it actually resolves.
 */
describe("overlay renderer's TypeScript", () => {
  it("is a TypeScript with the JS compiler API that @remotion/bundler needs", () => {
    const fromOverlayRenderer = createRequire(
      path.resolve(
        import.meta.dirname,
        "../packages/overlay-renderer/package.json"
      )
    );
    const bundlerEntry = fromOverlayRenderer.resolve("@remotion/bundler");
    const fromBundler = createRequire(bundlerEntry);

    const typescript = fromBundler("typescript") as {
      version: string;
      sys?: { readFile?: unknown };
      readConfigFile?: unknown;
    };

    expect(typeof typescript.readConfigFile).toBe("function");
    expect(typeof typescript.sys?.readFile).toBe("function");
  });
});
