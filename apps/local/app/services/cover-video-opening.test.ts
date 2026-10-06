import { describe, expect, it } from "vitest";
import { coverVideoOpening } from "./cover-video-opening";

const clips = [
  { id: "c1", order: "a0" },
  { id: "c2", order: "a1" },
  { id: "c3", order: "a2" },
];

describe("making sure proposed Chapters cover the opening of the Video", () => {
  it("leaves a set that already opens on the first clip unchanged", () => {
    const proposals = [
      { beforeClipId: "c1", title: "Setting up" },
      { beforeClipId: "c3", title: "Wrapping up" },
    ];
    expect(coverVideoOpening(proposals, clips)).toEqual(proposals);
  });

  it("prepends an Intro on the first clip when the earliest Chapter starts later", () => {
    expect(
      coverVideoOpening([{ beforeClipId: "c2", title: "The problem" }], clips)
    ).toEqual([
      { beforeClipId: "c1", title: "Intro" },
      { beforeClipId: "c2", title: "The problem" },
    ]);
  });

  it("returns a single Intro when the model proposed nothing", () => {
    expect(coverVideoOpening([], clips)).toEqual([
      { beforeClipId: "c1", title: "Intro" },
    ]);
  });

  it("finds the first clip by timeline order, not array position", () => {
    const shuffled = [clips[2]!, clips[0]!, clips[1]!];
    expect(
      coverVideoOpening(
        [{ beforeClipId: "c2", title: "The problem" }],
        shuffled
      )
    ).toEqual([
      { beforeClipId: "c1", title: "Intro" },
      { beforeClipId: "c2", title: "The problem" },
    ]);
  });

  it("adds nothing to a Video with no clips", () => {
    expect(coverVideoOpening([], [])).toEqual([]);
  });
});
