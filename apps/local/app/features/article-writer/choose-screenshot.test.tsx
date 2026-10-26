import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IndexedClip } from "./types";
import { ChooseScreenshot } from "./choose-screenshot";
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
const render = (clip: IndexedClip, face: ScreenshotFace = "none") =>
  renderToStaticMarkup(
    <ChooseScreenshot
      clipIndex={1}
      alt="The diagram"
      clips={[clip]}
      onClipIndexChange={() => {}}
      onCapture={async () => true}
      onRemove={() => {}}
      face={face}
      onFaceChange={() => {}}
    />
  );

const pressed = (html: string, label: string) =>
  new RegExp(`aria-pressed="true"[^>]*>${label}<`).test(html);

describe("ChooseScreenshot's face toggle", () => {
  it("offers Diagram on a CVM-recorder Clip with no Diagram Frame remembered", () => {
    const html = render(recorderClip(true));
    expect(html).toContain(">No face<");
    expect(html).toContain(">Diagram<");
    expect(html).toContain(">With face<");
  });

  it("boxes the computed Diagram Frame when Diagram is chosen", () => {
    const html = render(recorderClip(true), "diagram");
    expect(pressed(html, "Diagram")).toBe(true);
    expect(html).toContain('data-testid="diagram-frame-box"');
  });

  it("is not shown on an OBS Clip or a camera-only session", () => {
    for (const clip of [obsClip, recorderClip(false)]) {
      const html = render(clip);
      expect(html).not.toContain(">Diagram<");
      expect(html).not.toContain(">No face<");
    }
  });
});
