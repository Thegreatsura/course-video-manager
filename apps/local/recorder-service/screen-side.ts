import type { VideoFormat } from "@/features/videos/video-format";
import { drawnSources, type Scene } from "../app/packages/scene-layout";
import { quitProcess } from "./camera";
import { PREVIEW_TAGS, screenPreviewArgs } from "./capture-args";
import type { LaunchedProcess, Launcher } from "./launcher";
import type { ScreenStatus } from "./protocol";
import { findByName, Refusal } from "./refusal";
import { listScreens, type Screen } from "./windows-devices";

/**
 * THE RECORDER'S SCREEN, per Video format: which ddagrab output is recorded
 * and previewed. Landscape records the DELL, found by its EDID name and
 * checked at Record. A Short records the Spacedesk virtual display, found by
 * its display adapter's name (its monitor has no EDID name), woken only when
 * it is not listed. It is landscape 1920x1080 like any screen: the Short
 * layout shows its left square, so it is usable at any 16:9 size and refused
 * only at another shape, which the square would come out stretched from.
 * Its preview is 960x540, like the DELL's. Unavailable, a Short
 * records camera and mic only, and the scenes that draw the screen are
 * refused (`refuseScreenlessScene`).
 */

export const SCREEN_NAME = "DELL U2424H";
/** A Short's screen, found by its display adapter: its monitor has no EDID name. */
export const SPACEDESK_ADAPTER = "spacedesk";
/**
 * Why the Spacedesk display cannot be a Short's screen, if it cannot: the
 * Short layout crops its left square as a fraction of a 16:9 frame, so any
 * other shape would come out stretched.
 */
const unusableSize = (screen: Screen) =>
  screen.width * 9 === screen.height * 16
    ? undefined
    : `The Spacedesk display is ${screen.width}x${screen.height}, not landscape 16:9: set Spacedesk back to 1920x1080, then wake it again.`;

/** Refuses a scene that draws the screen while a Short's screen is unavailable. */
export const refuseScreenlessScene = (
  scene: Scene,
  format: VideoFormat,
  screen: ScreenStatus | null
) => {
  if (
    screen?.kind === "unavailable" &&
    drawnSources([{ scene }], format).includes("screen")
  )
    throw new Refusal(
      `${scene} shows the screen, and this Short's screen is unavailable: ${screen.message} Use Camera to record without it.`
    );
};

/**
 * Refuses a Stream Deck switch to a scene that draws the screen while a
 * Short's screen is still waking, as the editor's scene buttons do.
 */
export const refuseWakingScene = (
  scene: Scene,
  format: VideoFormat,
  screen: ScreenStatus | null
) => {
  if (
    screen?.kind === "waking" &&
    drawnSources([{ scene }], format).includes("screen")
  )
    throw new Refusal(
      `${scene} shows the screen, and Spacedesk is still waking: wait for the screen.`
    );
};

export const createScreenSide = (o: {
  launch: Launcher;
  /** The service's screen preview feed. */
  previewPort: () => number;
  wakeSpacedesk: () => Promise<void>;
  /** The open recorder's format; undefined while closed. */
  format: () => VideoFormat | undefined;
  /** A Short's screen status, for the state. */
  setStatus: (screen: ScreenStatus) => void;
}) => {
  let preview: LaunchedProcess | undefined;
  /** Bumped whenever the screen side starts again: an older check's answer is dropped. */
  let generation = 0;

  const startPreview = (screenIndex: number) => {
    if (!o.format() || preview) return;
    const p = o.launch({
      tool: "ffmpeg",
      args: screenPreviewArgs({ screenIndex, port: o.previewPort() }),
      cwd: "/mnt/c",
    });
    preview = p;
    void p.exited.then((code) => {
      if (preview !== p) return;
      preview = undefined;
      console.error(`recorder: the screen preview quit (exit ${code})`);
    });
  };

  const stopPreview = async () => {
    const p = preview;
    preview = undefined;
    if (p) await quitProcess(p, { launch: o.launch, tag: PREVIEW_TAGS.screen });
  };

  const findSpacedesk = async () =>
    findByName(
      await listScreens(o.launch),
      (s) => s.adapter,
      SPACEDESK_ADAPTER
    );

  /** Finds the Spacedesk display, waking Spacedesk only when it is not listed. */
  const spacedeskScreen = async (): Promise<
    | { kind: "ready"; screen: Screen }
    | Extract<ScreenStatus, { kind: "unavailable" }>
  > => {
    const unavailable = (message: string) =>
      ({ kind: "unavailable", message }) as const;
    let spacedesk = await findSpacedesk();
    if (!spacedesk) {
      try {
        await o.wakeSpacedesk();
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return unavailable(`Could not wake Spacedesk: ${reason}`);
      }
      spacedesk = await findSpacedesk();
    }
    if (!spacedesk)
      return unavailable(
        "Spacedesk woke, but its display is not among the screens the recorder can capture."
      );
    const problem = unusableSize(spacedesk);
    return problem
      ? unavailable(problem)
      : { kind: "ready", screen: spacedesk };
  };

  /**
   * Starts the screen side again for the open recorder's format: the DELL's
   * preview for Landscape; for a Short, the Spacedesk display found (woken
   * if need be) and its preview. Not awaited by the command queue:
   * a wake takes seconds, and nothing waits on it.
   *
   * A Short is `waking` before the first await, so a command queued right
   * behind (Record, retry-screen) never sees the old status; and only the
   * latest restart sets a status, so an overtaken one never overwrites it.
   */
  const restart = async () => {
    const check = (generation += 1);
    const format = o.format();
    const current = () => check === generation && o.format() === format;
    if (format === "short") o.setStatus({ kind: "waking" });
    try {
      await stopPreview();
      if (!current()) return;
      if (format === "landscape") {
        const screens = await listScreens(o.launch);
        const dell = findByName(screens, (s) => s.name, SCREEN_NAME);
        if (dell && current()) startPreview(dell.index);
        return;
      }
      if (format !== "short") return;
      const found = await spacedeskScreen();
      if (!current()) return;
      if (found.kind === "unavailable") return o.setStatus(found);
      o.setStatus({ kind: "ready" });
      startPreview(found.screen.index);
    } catch (e) {
      console.error("recorder: could not start the screen side", e);
      if (current())
        o.setStatus({
          kind: "unavailable",
          message: `Could not look for the Spacedesk display: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
  };

  /** The DELL's output, at the size the recorder records it at. */
  const dellIndex = async () => {
    const screens = await listScreens(o.launch);
    const screen = findByName(screens, (s) => s.name, SCREEN_NAME);
    if (!screen) {
      throw new Refusal(
        `No screen named ${SCREEN_NAME}. Found: ${screens.map((s) => s.name).join(", ") || "none"}`
      );
    }
    if (screen.width !== 1920 || screen.height !== 1080) {
      throw new Refusal(
        `The ${SCREEN_NAME} is ${screen.width}x${screen.height}; the recorder records it at 1920x1080.`
      );
    }
    return screen.index;
  };

  /**
   * A Short's screen output, listed again at Record; null to record camera
   * and mic only, which the scene must allow.
   */
  const shortIndex = async (screen: ScreenStatus | null, scene: Scene) => {
    if (screen?.kind === "waking")
      throw new Refusal(
        "Spacedesk is still waking: wait for the screen before recording."
      );
    let status = screen;
    if (status?.kind === "ready") {
      const spacedesk = await findSpacedesk();
      const problem = spacedesk
        ? unusableSize(spacedesk)
        : "The Spacedesk display is no longer among the screens: wake it again.";
      if (spacedesk && !problem) return spacedesk.index;
      status = { kind: "unavailable", message: problem ?? "" };
      o.setStatus(status);
      await stopPreview();
    }
    refuseScreenlessScene(scene, "short", status);
    return null;
  };

  return {
    restart,
    /** The recorder closed: drops any check under way and stops the preview. */
    close: () => {
      generation += 1;
      return stopPreview();
    },
    /** The ddagrab output to record, or null for none; refuses with why. */
    recordIndex: (
      format: VideoFormat,
      screen: ScreenStatus | null,
      scene: Scene
    ): Promise<number | null> =>
      format === "short" ? shortIndex(screen, scene) : dellIndex(),
  };
};
