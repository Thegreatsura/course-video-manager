import { describe, expect, it } from "vitest";
import { remountCommandFor } from "../index";

describe("remountCommandFor", () => {
  it("remounts a Windows drive's root as drvfs, owned by Matt", () => {
    expect(remountCommandFor("/mnt/e")).toBe(
      "sudo umount -l /mnt/e; sudo mount -t drvfs E: /mnt/e -o uid=1000,gid=1000"
    );
    expect(remountCommandFor("/mnt/d")).toBe(
      "sudo umount -l /mnt/d; sudo mount -t drvfs D: /mnt/d -o uid=1000,gid=1000"
    );
  });

  it("offers no command for a root that is not a whole drive", () => {
    expect(remountCommandFor("/srv/footage")).toBeNull();
  });
});
