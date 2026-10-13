import { describe, expect, it } from "vitest";
import { judgeStorageRoots } from "./storage-roots";

describe("judgeStorageRoots (the startup check)", () => {
  const online = (dirs: string[]) => (root: string) => dirs.includes(root);

  it("refuses to start without STORAGE_ROOTS, naming it", () => {
    const { refusal } = judgeStorageRoots({}, online([]));
    expect(refusal).toMatch(/^STORAGE_ROOTS is not set/);
  });

  it("refuses an invalid list", () => {
    expect(
      judgeStorageRoots({ STORAGE_ROOTS: "mnt/d" }, online([])).refusal
    ).toMatch(/not an absolute directory/);
  });

  it("starts, reporting each root that is not there as offline", () => {
    expect(
      judgeStorageRoots({ STORAGE_ROOTS: "/mnt/d,/mnt/e" }, online(["/mnt/d"]))
    ).toEqual({ refusal: undefined, offline: ["/mnt/e"] });
  });
});
