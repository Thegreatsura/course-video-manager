import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import type { VideoFormat } from "@cvm/core/features/videos/video-format";
import { CANVASES, type SceneSegment } from "@/packages/scene-layout";
import { cn } from "@/lib/utils";
import { drawComposite, type CompositeSourceFrame } from "../draw-composite";
import { useCompositePlayback } from "../use-composite-playback";
import { useStillsWaitForVideo } from "./queued-still";

const CAMERA_ONLY = ["camera"] as const;
const CAMERA_AND_SCREEN = ["camera", "screen"] as const;

/** A picture `<video>`'s current frame, once it has one. */
const frameOf = (
  video: HTMLVideoElement | null
): CompositeSourceFrame | undefined =>
  video && video.videoWidth > 0 && video.readyState >= 2
    ? {
        image: video,
        size: { width: video.videoWidth, height: video.videoHeight },
      }
    : undefined;

/**
 * A CVM-recorder Clip played as the composite: its camera and screen files
 * play, muted and out of sight, in step with the clock `<video>` (the Clip's
 * mic, which carries the sound), and a canvas draws them every animation
 * frame with the layout module's draw instructions for the scene of the
 * moment — the same maths as the live preview and the export. The canvas is
 * the Recording Session format's (9:16 for a Short); a picture that never
 * draws the screen mounts no screen `<video>`.
 */
export const CompositePlayback = (props: {
  clock: RefObject<HTMLVideoElement | null>;
  picture: {
    format: VideoFormat;
    camera: string;
    /** Null when the picture never draws the screen. */
    screen: string | null;
    segments: readonly SceneSegment[];
  };
  offsetSeconds: number;
  hidden: boolean;
  /** The editor wants this Clip playing: a play then waits for the picture. */
  editorPlaying: boolean;
  className?: string;
  style?: CSSProperties;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { format } = props.picture;
  const canvas = CANVASES[format];
  const { camera, screen, scene } = useCompositePlayback({
    clock: props.clock,
    segments: props.picture.segments,
    offsetSeconds: props.offsetSeconds,
    sources: props.picture.screen === null ? CAMERA_ONLY : CAMERA_AND_SCREEN,
    editorPlaying: props.editorPlaying,
  });
  useStillsWaitForVideo(camera, props.picture.camera);
  useStillsWaitForVideo(screen, props.picture.screen);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || props.hidden) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      // Mid-seek a `<video>` has no frame to give: keep the last one drawn
      // rather than flash black.
      if (camera.current?.seeking || screen.current?.seeking) return;
      drawComposite(
        ctx,
        scene,
        {
          camera: frameOf(camera.current),
          screen: frameOf(screen.current),
        },
        format
      );
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene, props.hidden, format]);

  const offscreen = "pointer-events-none absolute size-px opacity-0";
  return (
    <>
      <canvas
        ref={canvasRef}
        width={canvas.width}
        height={canvas.height}
        className={cn(
          "block w-full bg-black",
          format === "short" ? "aspect-[9/16]" : "aspect-[16/9]",
          props.className
        )}
        style={props.style}
        data-testid="composite-playback"
        data-scene={scene}
      />
      <video
        ref={camera}
        src={props.picture.camera}
        muted
        playsInline
        preload="auto"
        className={offscreen}
      />
      {props.picture.screen !== null && (
        <video
          ref={screen}
          src={props.picture.screen}
          muted
          playsInline
          preload="auto"
          className={offscreen}
        />
      )}
    </>
  );
};
