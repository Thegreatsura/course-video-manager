#!/usr/bin/env node
/**
 * The outermost bin edge for the globally-linked `cvm` command. This is the
 * ONLY place process.exit is allowed.
 *
 * It is a PLAIN Node launcher (not TypeScript) on purpose: it must run before
 * tsx is initialised so it can pin tsx to THIS project's tsconfig. tsx resolves
 * the `@/*` path aliases from whatever tsconfig it discovers from the current
 * working directory, so without this pin `cvm` only works when invoked from
 * inside the repo. Anchoring TSX_TSCONFIG_PATH to this file's location makes the
 * aliases resolve no matter where `cvm` is run from. CVM_API_URL /
 * CVM_API_TOKEN (and, while some verbs are still wired in-process,
 * DATABASE_URL) are resolved inside runCli, anchored to this install location.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH ??= resolve(here, "../../tsconfig.json");

// tsImport boots tsx programmatically AFTER the tsconfig pin is in place, so the
// TypeScript source (and its `@/*` imports) runs directly without a build step.
const { tsImport } = await import("tsx/esm/api");
const { runCli } = await tsImport("./main.ts", import.meta.url);

/**
 * Exit only once stdout and stderr have flushed. When stdout is a PIPE
 * (`cvm … | jq`), Node writes to it asynchronously, so a bare process.exit
 * drops everything past the first 64KB still sitting in the pipe buffer — a
 * large `course tree --depth all` reached jq cut off mid-object. An empty
 * write's callback fires only after every write queued before it, so waiting
 * on one per stream guarantees the output is complete before exiting.
 */
const flushThenExit = (code) => {
  let pending = 2;
  const done = () => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
};

runCli(process.argv.slice(2)).then(
  (code) => flushThenExit(code),
  (cause) => {
    // Last-resort guard: runCli is designed never to reject, but if something
    // escapes, render a clean DatabaseError (never a raw stack) and exit 4.
    process.stderr.write(
      JSON.stringify({ _tag: "DatabaseError", message: String(cause) }) + "\n"
    );
    flushThenExit(4);
  }
);
