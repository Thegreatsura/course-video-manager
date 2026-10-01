import { describe, expect, it } from "vitest";
import { parseScriptBlocks } from "./script-blocks";

const kinds = (script: string) => parseScriptBlocks(script).map((b) => b.kind);

describe("parseScriptBlocks", () => {
  it("keeps a fenced block whole, blank lines and all", () => {
    const [block] = parseScriptBlocks("```bash\nnpm i\n\nnpm run dev\n```");
    expect(block).toMatchObject({ kind: "code", text: "npm i\n\nnpm run dev" });
  });

  it("splits the prose on either side of a fence", () => {
    expect(kinds("Run it:\n```\nls\n```\nThen look.")).toEqual([
      "para",
      "code",
      "para",
    ]);
  });

  it("runs an unclosed fence to the end of the script", () => {
    expect(parseScriptBlocks("```\nls\n\nmore")).toMatchObject([
      { kind: "code", text: "ls\n\nmore" },
    ]);
  });

  it("keeps an instructions region whole, anywhere in the script", () => {
    const script =
      "Say this.\n\n<instructions>\n\nOpen the file.\n\n```\nls\n```\n\n</instructions>\n\nSay that.";
    expect(kinds(script)).toEqual(["para", "instructions", "para"]);
    expect(parseScriptBlocks(script)[1]!.text).toBe(
      "Open the file.\n\n```\nls\n```"
    );
  });

  it("does not close an instructions region on a tag inside a fence", () => {
    const script =
      "<instructions>\n```\n</instructions>\n```\nStill inside.\n</instructions>";
    expect(kinds(script)).toEqual(["instructions"]);
  });

  it("drops an empty instructions region", () => {
    expect(kinds("<instructions>\n\n</instructions>\n\nSay this.")).toEqual([
      "para",
    ]);
  });

  // The brackets are set as written; the kind only keeps the words out of the
  // crawl's pace.
  it("keeps a cue block's brackets", () => {
    expect(parseScriptBlocks("[point at the badge]")).toMatchObject([
      { kind: "cue", text: "[point at the badge]" },
    ]);
  });
});
