import { describe, expect, it } from "vitest";
import {
  nestHeadingSections,
  type HeadingNode,
  type HeadingRank,
} from "./heading-sections";

/** Rows as strings: "## x" is an H2, "### x" an H3, "# x" an H1. */
const rankOf = (row: string): HeadingRank =>
  row.startsWith("### ")
    ? "h3"
    : row.startsWith("## ")
      ? "h2"
      : row.startsWith("# ")
        ? "break"
        : null;

/** A compact picture of the tree: a section is [heading, ...children]. */
type Shape = string | [string, ...Shape[]];
const shape = (nodes: readonly HeadingNode<string>[]): Shape[] =>
  nodes.map((n) =>
    n.kind === "row" ? n.row : [n.heading, ...shape(n.children)]
  );

const nest = (rows: string[]) => shape(nestHeadingSections(rows, rankOf));

describe("nestHeadingSections", () => {
  it("holds everything up to the next H2 inside an H2's section", () => {
    expect(nest(["intro", "## A", "a1", "a2", "## B", "b1"])).toEqual([
      "intro",
      ["## A", "a1", "a2"],
      ["## B", "b1"],
    ]);
  });

  it("nests an H3 inside its H2, ending it at the next H3 or H2", () => {
    expect(
      nest(["## A", "a", "### A1", "x", "### A2", "y", "## B", "b"])
    ).toEqual([
      ["## A", "a", ["### A1", "x"], ["### A2", "y"]],
      ["## B", "b"],
    ]);
  });

  it("lets an H3 before any H2 stand on its own", () => {
    expect(nest(["### Lone", "x", "## A", "a"])).toEqual([
      ["### Lone", "x"],
      ["## A", "a"],
    ]);
  });

  it("closes every open section at an H1, which stays a plain row", () => {
    expect(nest(["## A", "### A1", "x", "# Part two", "y"])).toEqual([
      ["## A", ["### A1", "x"]],
      "# Part two",
      "y",
    ]);
  });
});
