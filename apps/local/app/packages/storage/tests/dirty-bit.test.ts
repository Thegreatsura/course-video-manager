import { describe, expect, it } from "vitest";
import { parseDirtyQueryOutput, windowsDriveOf } from "../buckets";

describe("the dirty-bit query", () => {
  it("reads fsutil's answer", () => {
    expect(parseDirtyQueryOutput("Volume - E: is Dirty\r\n")).toBe("dirty");
    expect(parseDirtyQueryOutput("Volume - D: is NOT Dirty\r\n")).toBe("clean");
  });

  it("reads chkntfs's display-only answer", () => {
    expect(
      parseDirtyQueryOutput(
        "The type of the file system is exFAT.\r\nE: is dirty.  You may use the /C option to schedule chkdsk for this drive.\r\n"
      )
    ).toBe("dirty");
    expect(
      parseDirtyQueryOutput(
        "The type of the file system is NTFS.\r\nD: is not dirty.\r\n"
      )
    ).toBe("clean");
  });

  it("is unknown when Windows won't say", () => {
    expect(parseDirtyQueryOutput("Error:  Access is denied.\r\n")).toBe(
      "unknown"
    );
    expect(
      parseDirtyQueryOutput(
        "The FSUTIL utility requires that you have administrative privileges.\r\n"
      )
    ).toBe("unknown");
    expect(parseDirtyQueryOutput("")).toBe("unknown");
  });

  it("only asks about Windows drives", () => {
    expect(windowsDriveOf("/mnt/e")).toBe("E:");
    expect(windowsDriveOf("/mnt/d/cvm")).toBe("D:");
    expect(windowsDriveOf("/home/matt/storage")).toBeNull();
    expect(windowsDriveOf("/mnt/wsl")).toBeNull();
  });
});
