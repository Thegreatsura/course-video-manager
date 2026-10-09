import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sidecarSocketPath } from "./sidecar-socket.server";

/** The checkout this test file lives in — where `run-sidecar.ts` listens. */
const CHECKOUT = path.resolve(import.meta.dirname, "../../../..");

describe("sidecarSocketPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("finds this checkout's socket whatever folder `cvm` was run from", () => {
    vi.stubEnv("CVM_SIDECAR_SOCKET", "");
    // The globally-linked `cvm` runs from any folder — another repo, $HOME.
    vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());

    expect(sidecarSocketPath()).toBe(
      path.join(CHECKOUT, ".data", "sidecar.sock")
    );
  });
});
