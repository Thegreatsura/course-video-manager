import { afterEach, describe, expect, it } from "vitest";
import { ensureApiConfig } from "./env";
import { checkVerifyClone, VERIFY_CLONE_ENV_KEY } from "./verify-clone";

/**
 * Verify-clone mode is how `verify.sh cvm` runs a worktree's `cvm` for real.
 * It must only ever reach the run's own API and clone — these are the cases
 * that would otherwise send a worktree's unmerged `cvm` to production.
 */
const CLONE = "cvm_verify_20261009_101500_4242";
const good = {
  clone: CLONE,
  apiUrl: "http://127.0.0.1:41234",
  databaseUrl: `postgresql://postgres:pw@localhost:5433/${CLONE}`,
};

describe("checkVerifyClone", () => {
  it("accepts the run's loopback API and its own clone", () => {
    expect(checkVerifyClone(good)).toEqual({ ok: true, clone: CLONE });
    expect(
      checkVerifyClone({ ...good, apiUrl: "http://localhost:5300/" }).ok
    ).toBe(true);
    expect(checkVerifyClone({ ...good, apiUrl: "http://[::1]:5300" }).ok).toBe(
      true
    );
  });

  it.each([
    ["the deployed API", "https://cvm-remote.vercel.app"],
    ["a LAN address", "http://192.168.1.20:3000"],
    ["every interface", "http://0.0.0.0:3000"],
    ["https on loopback", "https://127.0.0.1:3000"],
    ["a hostname that merely starts with 127", "http://127.0.0.1.evil.com"],
    ["nothing", undefined],
  ])("refuses a non-loopback API URL: %s", (_, apiUrl) => {
    const verdict = checkVerifyClone({ ...good, apiUrl });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/CVM_API_URL/);
  });

  it("refuses a database that is not the named clone", () => {
    for (const databaseUrl of [
      "postgresql://u:p@aws.connect.psdb.cloud/cvm",
      `postgresql://u:p@db.example.com:5432/${CLONE}`,
      "postgresql://postgres:pw@localhost:5433/cvm_verify_template",
      "postgresql://postgres:pw@localhost:5433/cvm_verify_20261009_000000_1",
      undefined,
    ]) {
      expect(checkVerifyClone({ ...good, databaseUrl }).ok).toBe(false);
    }
  });

  it("refuses a clone name that is not a per-run clone", () => {
    for (const clone of ["cvm_verify_template", "postgres", "", undefined]) {
      expect(checkVerifyClone({ ...good, clone }).ok).toBe(false);
    }
  });
});

describe("ensureApiConfig in verify-clone mode", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses before any request when the API is not loopback", () => {
    process.env[VERIFY_CLONE_ENV_KEY] = CLONE;
    process.env.CVM_API_URL = "https://cvm-remote.vercel.app";
    process.env.CVM_API_TOKEN = "t";
    process.env.DATABASE_URL = good.databaseUrl;
    const result = ensureApiConfig();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(
      /refusing verify-clone mode: CVM_API_URL is not the run.s own API/
    );
  });

  it("passes through when everything points at the clone", () => {
    process.env[VERIFY_CLONE_ENV_KEY] = CLONE;
    process.env.CVM_API_URL = good.apiUrl;
    process.env.CVM_API_TOKEN = "t";
    process.env.DATABASE_URL = good.databaseUrl;
    expect(ensureApiConfig().ok).toBe(true);
  });
});
