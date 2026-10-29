import { describe, expect, it } from "vitest";
import {
  hiddenRootsOf,
  onlyRootFilterChanged,
  withRootFilter,
  withRootToggled,
} from "./root-filter";

/** The Storage Root filter in the URL (#2431). */
describe("the Storage Root filter's URL", () => {
  it("toggles a root in and out, keeps other params, and links carry it", () => {
    const hidden = withRootToggled(new URLSearchParams("q=1"), "/mnt/e");
    expect(hiddenRootsOf(hidden)).toEqual(["/mnt/e"]);
    expect(hidden.get("q")).toBe("1");
    expect(hiddenRootsOf(withRootToggled(hidden, "/mnt/e"))).toEqual([]);
    expect(withRootFilter("/storage", ["/mnt/e"])).toBe(
      "/storage?hide=%2Fmnt%2Fe"
    );
    expect(withRootFilter("/storage", [])).toBe("/storage");
  });

  it("a toggle alone loads nothing again; another page or param does", () => {
    const at = (path: string) => new URL(path, "http://cvm");
    expect(
      onlyRootFilterChanged(at("/storage"), at("/storage?hide=%2Fmnt%2Fe"))
    ).toBe(true);
    expect(
      onlyRootFilterChanged(at("/storage"), at("/storage/x?hide=%2Fmnt%2Fe"))
    ).toBe(false);
    expect(onlyRootFilterChanged(at("/storage"), at("/storage?q=1"))).toBe(
      false
    );
  });
});
