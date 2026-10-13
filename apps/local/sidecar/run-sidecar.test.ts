import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The Sidecar's entry point, started the way `start:sidecar` starts it: a
 * real `tsx sidecar/run-sidecar.ts` process. Its `.env` is a temp file
 * (`CVM_SIDECAR_ENV_FILE`), and DATABASE_URL is set nowhere, so a run that
 * gets past every other check says "not started: DATABASE_URL is not set"
 * and exits 0 without touching a database.
 *
 * Guards against the `.env` being loaded after the modules that read it: the
 * Sidecar crash-looped on `InvalidStorageRootsError: STORAGE_ROOTS is not set`
 * with STORAGE_ROOTS in `.env`, because `layer.server.ts` asserts it while it
 * is imported and the `.env` was only loaded inside `main()`.
 */

const APP_DIR = path.resolve(import.meta.dirname, "..");
const TSX = path.join(APP_DIR, "node_modules", ".bin", "tsx");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-sidecar-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const startSidecar = async (opts: {
  dotEnv: string;
  env?: Record<string, string>;
}) => {
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, opts.dotEnv);
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Vitest's own markers would stop run-sidecar.ts from calling main().
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) delete env[key];
  }
  delete env.STORAGE_ROOTS;
  delete env.DATABASE_URL;
  delete env.DIRECT_DATABASE_URL;
  delete env.NODE_ENV;
  const { stdout, stderr } = await promisify(execFile)(
    TSX,
    ["sidecar/run-sidecar.ts"],
    {
      cwd: APP_DIR,
      env: { ...env, CVM_SIDECAR_ENV_FILE: envFile, ...opts.env },
      timeout: 60_000,
    }
  );
  return stdout + stderr;
};

describe("run-sidecar", () => {
  it("reads STORAGE_ROOTS from .env before any module that asserts it is loaded", async () => {
    const root = fs.mkdtempSync(path.join(dir, "root-"));
    const output = await startSidecar({ dotEnv: `STORAGE_ROOTS="${root}"\n` });

    expect(output).not.toContain("STORAGE_ROOTS is not set");
    expect(output).toContain("not started: DATABASE_URL is not set");
  }, 90_000);

  it("lets a variable already set win over .env", async () => {
    const fromDotEnv = fs.mkdtempSync(path.join(dir, "dotenv-root-"));
    const fromProcess = path.join(dir, "process-root-not-mounted");
    const output = await startSidecar({
      dotEnv: `STORAGE_ROOTS="${fromDotEnv}"\n`,
      env: { STORAGE_ROOTS: fromProcess },
    });

    expect(output).toContain(`Storage Root ${fromProcess} is offline`);
    expect(output).not.toContain(fromDotEnv);
    expect(output).toContain("not started: DATABASE_URL is not set");
  }, 90_000);
});
