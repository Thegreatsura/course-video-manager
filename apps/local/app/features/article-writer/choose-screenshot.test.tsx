import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IndexedClip } from "./types";
import { ChooseScreenshot, FACE_OPTIONS } from "./choose-screenshot";
import type { ScreenCrop } from "@/packages/clip-source";
import type { ScreenshotFace } from "./choose-screenshot-mutations";

const recorderClip = (screenCaptured: boolean): IndexedClip => ({
  index: 1,
  sourceStartTime: 10,
  sourceEndTime: 20,
  videoFilename: "camera.mkv",
  text: "Here is the diagram.",
  recordingSession: {
    id: "session-1",
    cameraFilePath: "/rec/camera.mkv",
    screenFilePath: "/rec/screen.mkv",
    micFilePath: "/rec/mic.wav",
    micOffsetMs: 0,
    format: "landscape",
    screenCaptured,
    sceneEvents: [{ fileTime: 0, scene: "Code" }],
  },
});

const obsClip: IndexedClip = {
  index: 1,
  sourceStartTime: 10,
  sourceEndTime: 20,
  videoFilename: "/footage/obs.mkv",
  text: "Here is the diagram.",
};

// No Diagram Frame is remembered: there is no localStorage here, as on a
// browser whose playground has never centred full screen.
const render = (
  clip: IndexedClip,
  face: ScreenshotFace = "none",
  crop: ScreenCrop | null = null
) =>
  renderToStaticMarkup(
    <ChooseScreenshot
      clipIndex={1}
      alt="The diagram"
      clips={[clip]}
      onClipIndexChange={() => {}}
      onCapture={async () => true}
      onRemove={() => {}}
      face={face}
      crop={crop}
      onFaceChange={() => {}}
    />
  );

const SELECT = 'aria-label="Screenshot mode"';

describe("ChooseScreenshot's face select", () => {
  it("offers No face, Diagram, With face and Custom, in P's order", () => {
    expect(render(recorderClip(true))).toContain(SELECT);
    expect(FACE_OPTIONS.map(([, label]) => label)).toEqual([
      "No face",
      "Diagram",
      "With face",
      "Custom",
    ]);
  });

  it("boxes the computed Diagram Frame when Diagram is chosen", () => {
    const html = render(recorderClip(true), "diagram");
    expect(html).toContain('data-testid="diagram-frame-box"');
  });

  it("boxes Custom's saved crop, with its eight handles", () => {
    const html = render(recorderClip(true), "custom", {
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.25,
    });
    expect(html).toMatch(/left:10%;top:20%;width:50%;height:25%/);
    expect(html.match(/data-crop-handle=/g)).toHaveLength(8);
  });

  it("boxes nothing for No face, but the frame still takes a drag", () => {
    const html = render(recorderClip(true));
    expect(html).not.toContain('data-testid="diagram-frame-box"');
    expect(html).toContain('data-testid="crop-overlay"');
  });

  it("is not shown on an OBS Clip or a camera-only session", () => {
    for (const clip of [obsClip, recorderClip(false)]) {
      expect(render(clip)).not.toContain(SELECT);
    }
  });
});

describe("ChooseScreenshot's frame steps", () => {
  it("has no step dials: I / O and Left / Right are fixed", () => {
    const html = render(recorderClip(true));
    expect(html).not.toContain("I/O step");
    expect(html).not.toContain('type="number"');
  });
});
