import { Button } from "@/components/ui/button";
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  LoaderIcon,
  XIcon,
} from "lucide-react";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import { useRef, useState, useCallback, useEffect } from "react";
import type { IndexedClip } from "./types";
import {
  CHOOSE_SCREENSHOT_ATTR,
  SCREENSHOT_CAPTURE_EVENT,
  SCREENSHOT_FACE_EVENT,
  SCREENSHOT_STEP_EVENT,
  nextScreenshotFace,
  type ScreenshotCaptureRequest,
  type ScreenshotStep,
  type ScreenshotStepSize,
} from "./screenshot-navigation";
import { stepScreenshotFrame } from "./screenshot-frame-step";
import {
  clipCompositePicture,
  clipFrame,
  clipPlaybackClock,
  clipPlaybackUrl,
  clipScreenPicture,
  clipSource,
  type ClipFrame,
  type ScreenCrop,
} from "@/packages/clip-source";
import { diagramFrameFor } from "@/features/diagrams/diagram-frame";
import type { VideoFormat } from "@cvm/core/features/videos/video-format";
import { CompositePlayback } from "@/features/video-editor/components/composite-playback";
import { ScreenPlayback } from "@/features/video-editor/components/screen-playback";
import type { ScreenshotFace } from "./choose-screenshot-mutations";

const navAnchor = { [CHOOSE_SCREENSHOT_ATTR]: "" };

/** How far I / O (large) and Left / Right (small) move the frame, in seconds. */
const STEP_SECONDS: Record<ScreenshotStepSize, number> = {
  large: 1,
  small: 0.2,
};

export interface ChooseScreenshotProps {
  clipIndex: number;
  alt: string;
  clips: IndexedClip[];
  onClipIndexChange: (currentIndex: number, newIndex: number) => void;
  onCapture: (
    clipIndex: number,
    alt: string,
    frame: ClipFrame
  ) => Promise<boolean>;
  onRemove: (clipIndex: number, alt: string) => void;
  /** Saved on the placeholder: No face (the default) or With face. */
  face: ScreenshotFace;
  onFaceChange: (face: ScreenshotFace) => void;
  isCapturing?: boolean;
  isStreaming?: boolean;
}

export function ChooseScreenshot({
  clipIndex,
  alt,
  clips,
  onClipIndexChange,
  onCapture,
  onRemove,
  face,
  onFaceChange,
  isCapturing,
  isStreaming,
}: ChooseScreenshotProps) {
  const clip = clips.find((c) => c.index === clipIndex);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where the next clip shown opens: its end after I crossed back into it. */
  const landAtRef = useRef<"start" | "end">("start");

  // Every time kept here is the Clip's source time. The `<video>` is the
  // playback clock: an OBS Clip's Footage, or a CVM-recorder Clip's mic,
  // `offset` behind the picture (drawn by CompositePlayback).
  const source = clip ? clipSource(clip) : null;
  const offset = source ? clipPlaybackClock(source).offsetSeconds : 0;
  const seekVideo = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time - offset;
  };

  // No face shows the screen frame alone, when the Clip has one: an OBS
  // Clip's face is baked in, and a camera-only Short session has no screen.
  const screenPicture = screenPictureOf(clip, source);
  // The Diagram Frame for this format: remembered by the playground, or
  // computed the way it would compute it.
  const diagramFrame = screenDiagramFrame(screenPicture);
  const shot = recorderShot(screenPicture, face, diagramFrame);

  const isFirstClip = clipIndex <= 1;
  const isLastClip = clipIndex >= clips.length;

  const landingTime = (c: IndexedClip) =>
    landAtRef.current === "end" ? c.sourceEndTime : c.sourceStartTime;

  useEffect(() => {
    if (clip && videoRef.current) {
      const time = landingTime(clip);
      seekVideo(time);
      setCurrentTime(time);
    }
  }, [clip?.sourceStartTime]);

  const changeClip = (newIndex: number, landAt: "start" | "end") => {
    landAtRef.current = landAt;
    onClipIndexChange(clipIndex, newIndex);
  };

  const handleStep = ({ direction, size }: ScreenshotStep) => {
    if (!clip) return;
    const next = stepScreenshotFrame({
      time: currentTime,
      clipStart: clip.sourceStartTime,
      clipEnd: clip.sourceEndTime,
      clipIndex,
      clipCount: clips.length,
      step: STEP_SECONDS[size],
      direction,
    });
    if (next?.type === "seek") {
      seekVideo(next.time);
      setCurrentTime(next.time);
    } else if (next?.type === "change-clip") {
      changeClip(next.newIndex, next.landAt);
    }
  };
  const capture = () =>
    clip
      ? onCapture(
          clipIndex,
          alt,
          clipFrame(clipSource(clip), currentTime, shot)
        )
      : Promise.resolve(false);

  const handleCaptureRequest = async (request: ScreenshotCaptureRequest) => {
    if (isCapturing) return;
    if (await capture()) request.onCaptured();
  };

  // P: the toggle's next face, saved like a click on it. Nothing when the
  // toggle is not shown (no screen to show without the face).
  const handleFacePress = () => {
    if (screenPicture === null) return;
    onFaceChange(nextScreenshotFace(shot.face));
  };

  const handlersRef = useRef({
    handleStep,
    handleCaptureRequest,
    handleFacePress,
  });
  handlersRef.current = { handleStep, handleCaptureRequest, handleFacePress };

  // Bridge: the keys arrive from useScreenshotNavigation as DOM events.
  const isLive = Boolean(clip) && !isStreaming;
  useEffect(() => {
    const el = rootRef.current;
    if (!isLive || !el) return;
    const onStep = (e: Event) =>
      handlersRef.current.handleStep((e as CustomEvent<ScreenshotStep>).detail);
    const onCaptureRequest = (e: Event) =>
      void handlersRef.current.handleCaptureRequest(
        (e as CustomEvent<ScreenshotCaptureRequest>).detail
      );
    const onFace = () => handlersRef.current.handleFacePress();
    el.addEventListener(SCREENSHOT_STEP_EVENT, onStep);
    el.addEventListener(SCREENSHOT_CAPTURE_EVENT, onCaptureRequest);
    el.addEventListener(SCREENSHOT_FACE_EVENT, onFace);
    return () => {
      el.removeEventListener(SCREENSHOT_STEP_EVENT, onStep);
      el.removeEventListener(SCREENSHOT_CAPTURE_EVENT, onCaptureRequest);
      el.removeEventListener(SCREENSHOT_FACE_EVENT, onFace);
    };
  }, [isLive]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !clip) return;
    const time = videoRef.current.currentTime + offset;
    // Clamp to clip boundaries
    const clamped = Math.min(
      Math.max(time, clip.sourceStartTime),
      clip.sourceEndTime
    );
    if (clamped !== time) seekVideo(clamped);
    setCurrentTime(clamped);
  }, [clip, offset]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current || !clip) return;
      const time = parseFloat(e.target.value);
      seekVideo(time);
      setCurrentTime(time);
    },
    [clip, offset]
  );

  if (!clip) {
    return (
      <div
        {...navAnchor}
        className="transition-shadow my-4 rounded-lg border border-destructive bg-destructive/10 p-4"
      >
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <span className="text-sm font-medium">
            Invalid clip index: {clipIndex}
          </span>
        </div>
      </div>
    );
  }

  const duration = clip.sourceEndTime - clip.sourceStartTime;
  const picture = clipCompositePicture(source!, {
    from: clip.sourceStartTime,
    to: clip.sourceEndTime,
  });

  if (isStreaming) {
    return (
      <div
        {...navAnchor}
        className="transition-shadow my-4 rounded-lg border border-border bg-muted/50 p-4"
      >
        <p className="mb-2 text-xs text-muted-foreground">
          Clip {clipIndex} — {alt}
        </p>
        {clip.text && (
          <p className="mb-3 text-sm text-muted-foreground italic line-clamp-3">
            {clip.text}
          </p>
        )}
        <div className="w-full aspect-video rounded-md bg-muted flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoaderIcon className="h-4 w-4 animate-spin" />
            <span className="text-sm">Waiting for response to complete…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...navAnchor}
      ref={rootRef}
      className="transition-shadow my-4 rounded-lg border border-border bg-muted/50 p-4 relative"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={() => onRemove(clipIndex, alt)}
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
      <p className="mb-2 text-xs text-muted-foreground">
        Clip {clipIndex} — {alt}
      </p>
      {clip.text && (
        <p className="mb-3 text-sm text-muted-foreground italic line-clamp-3">
          {clip.text}
        </p>
      )}
      <video
        ref={videoRef}
        src={clipPlaybackUrl(source!, {
          from: clip.sourceStartTime,
          to: clip.sourceEndTime,
        })}
        className={cn("w-full rounded-md aspect-video", picture && "hidden")}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          // Re-apply the frame already chosen: a key pressed while the
          // video was loading must not be thrown away.
          seekVideo(
            Math.min(
              Math.max(currentTime, clip.sourceStartTime),
              clip.sourceEndTime
            )
          );
        }}
      />
      {picture && (
        <RecorderClipPicture
          clock={videoRef}
          picture={picture}
          screen={screenPicture?.screen ?? null}
          offsetSeconds={offset}
          noFace={shot.screenOnly}
          crop={shot.crop}
        />
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatDuration(currentTime - clip.sourceStartTime)}
        </span>
        <input
          type="range"
          min={clip.sourceStartTime}
          max={clip.sourceEndTime}
          step={0.1}
          value={currentTime}
          onChange={handleScrub}
          className="flex-1 h-1.5 accent-primary"
        />
        <span className="text-xs text-muted-foreground tabular-nums w-12">
          {formatDuration(duration)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isFirstClip}
          onClick={() => changeClip(clipIndex - 1, "start")}
        >
          <ChevronLeftIcon className="h-3 w-3 mr-1" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLastClip}
          onClick={() => changeClip(clipIndex + 1, "start")}
        >
          Next
          <ChevronRightIcon className="h-3 w-3 ml-1" />
        </Button>
        <div className="flex-1" />
        <ScreenshotFaceToggle
          available={screenPicture !== null}
          face={shot.face}
          onFaceChange={onFaceChange}
        />
        <Button size="sm" disabled={isCapturing} onClick={() => void capture()}>
          {isCapturing ? (
            <LoaderIcon className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <CameraIcon className="h-3 w-3 mr-1" />
          )}
          {isCapturing ? "Capturing…" : "Capture"}
        </Button>
      </div>
    </div>
  );
}

const screenPictureOf = (
  clip: IndexedClip | undefined,
  source: ReturnType<typeof clipSource> | null
) =>
  clip && source
    ? clipScreenPicture(source, {
        from: clip.sourceStartTime,
        to: clip.sourceEndTime,
      })
    : null;

/**
 * A CVM-recorder Clip's picture: the composite (With face), or its screen
 * frame alone (No face; Diagram boxes the Diagram Frame on it). Both stay
 * mounted, so each is already on the chosen frame when the other is clicked.
 */
function RecorderClipPicture(props: {
  clock: React.RefObject<HTMLVideoElement | null>;
  picture: NonNullable<ReturnType<typeof clipCompositePicture>>;
  /** Null when there is no screen to show without the face. */
  screen: string | null;
  offsetSeconds: number;
  noFace: boolean;
  /** Diagram: the Diagram Frame, boxed over the screen frame. */
  crop?: ScreenCrop;
}) {
  return (
    <>
      <CompositePlayback
        clock={props.clock}
        picture={props.picture}
        offsetSeconds={props.offsetSeconds}
        hidden={props.noFace}
        // A frame picker: it scrubs, it is never played as the editor.
        editorPlaying={false}
        className={cn("rounded-md", props.noFace && "hidden")}
      />
      {props.screen !== null && (
        <ScreenPlayback
          clock={props.clock}
          screen={props.screen}
          segments={props.picture.segments}
          offsetSeconds={props.offsetSeconds}
          className={cn(
            "rounded-md overflow-hidden",
            !props.noFace && "hidden"
          )}
        >
          {props.crop && <CropBox crop={props.crop} />}
        </ScreenPlayback>
      )}
    </>
  );
}

const pct = (n: number) => `${n * 100}%`;

/** The Diagram Frame boxed over the screen frame, the rest dimmed. */
function CropBox({ crop }: { crop: ScreenCrop }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute border-2 border-primary"
        data-testid="diagram-frame-box"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.w),
          height: pct(crop.h),
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
        }}
      />
    </div>
  );
}

/**
 * What a capture takes, from the saved face: the composite (With face, and
 * every Clip with no screen to show without the face), the screen frame
 * alone (No face), or that frame cut to the Diagram Frame (Diagram). `face`
 * is the one in effect, for the toggle to show.
 */
const recorderShot = (
  screenPicture: unknown,
  face: ScreenshotFace,
  diagramFrame: ScreenCrop | null
): { screenOnly: boolean; crop?: ScreenCrop; face: ScreenshotFace } => {
  if (screenPicture === null || face === "with") {
    return { screenOnly: false, face: "with" };
  }
  if (face === "diagram" && diagramFrame) {
    return { screenOnly: true, crop: diagramFrame, face: "diagram" };
  }
  return { screenOnly: true, face: "none" };
};

/** The Diagram Frame for the Clip's Video Format, when it has a screen. */
const screenDiagramFrame = (
  screenPicture: { readonly format: VideoFormat } | null
): ScreenCrop | null =>
  screenPicture ? diagramFrameFor(screenPicture.format) : null;

const FACE_OPTIONS = [
  ["none", "No face"],
  ["diagram", "Diagram"],
  ["with", "With face"],
] as const;

/**
 * No face / Diagram / With face, saved on the placeholder. Not shown when the
 * Clip has no screen to show without the face.
 */
function ScreenshotFaceToggle(props: {
  available: boolean;
  face: ScreenshotFace;
  onFaceChange: (face: ScreenshotFace) => void;
}) {
  if (!props.available) return null;
  return (
    <div className="flex items-center rounded-md border border-border">
      {FACE_OPTIONS.map(([value, label]) => (
        <Button
          key={value}
          variant={props.face === value ? "secondary" : "ghost"}
          size="sm"
          className="h-7 rounded-none first:rounded-l-md last:rounded-r-md"
          aria-pressed={props.face === value}
          onClick={() => props.onFaceChange(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
