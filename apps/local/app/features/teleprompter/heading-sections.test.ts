import { describe, expect, it } from "vitest";
import {
  nestHeadingSections,
  type HeadingNode,
  type HeadingRank,
} from "./heading-sections";

/** Rows as strings: "# x" is an H1, "## x" an H2, "### x" an H3. */
const rankOf = (row: string): HeadingRank =>
  row.startsWith("### ")
    ? "h3"
    : row.startsWith("## ")
      ? "h2"
      : row.startsWith("# ")
        ? "h1"
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

  // ~1 Script in 16 uses several H1s as its main sections.
  it("nests H2s and H3s inside their H1, ending all three at the next H1", () => {
    expect(
      nest(["# Part one", "## A", "### A1", "x", "# Part two", "y", "## B"])
    ).toEqual([
      ["# Part one", ["## A", ["### A1", "x"]]],
      ["# Part two", "y", ["## B"]],
    ]);
  });

  // Most Scripts open with a single H1 title: it holds the whole Script.
  it("holds the whole Script inside a single title H1", () => {
    expect(nest(["# Title", "intro", "## A", "a", "## B", "b"])).toEqual([
      ["# Title", "intro", ["## A", "a"], ["## B", "b"]],
    ]);
  });

  it("nests an H3 straight under an H1 when there is no H2 between", () => {
    expect(nest(["# T", "### Sub", "x", "## A", "a"])).toEqual([
      ["# T", ["### Sub", "x"], ["## A", "a"]],
    ]);
  });
});
