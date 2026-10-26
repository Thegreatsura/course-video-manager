import type { CSSProperties, ReactNode, RefObject } from "react";
import type { SceneSegment } from "@/packages/scene-layout";
import { cn } from "@/lib/utils";
import { useCompositePlayback } from "../use-composite-playback";

const SCREEN_ONLY = ["screen"] as const;

/**
 * A CVM-recorder Clip's screen frame alone (No face), shown as it was
 * recorded: its screen file plays, muted, in step with the clock `<video>`
 * (the Clip's mic), as {@link CompositePlayback} keeps its picture in step,
 * but the `<video>` itself is the picture, at the screen's own aspect, with
 * nothing drawn over it. `children` are laid over the picture.
 */
export const ScreenPlayback = (props: {
  clock: RefObject<HTMLVideoElement | null>;
  /** The screen file's URL, cued to the Clip. */
  screen: string;
  /** The picture's scene segments: the clock is read through them. */
  segments: readonly SceneSegment[];
  offsetSeconds: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) => {
  const { screen } = useCompositePlayback({
    clock: props.clock,
    segments: props.segments,
    offsetSeconds: props.offsetSeconds,
    sources: SCREEN_ONLY,
    // A frame picker: it scrubs, it is never played as the editor.
    editorPlaying: false,
  });
  return (
    <div
      className={cn("relative bg-black", props.className)}
      style={props.style}
    >
      <video
        ref={screen}
        src={props.screen}
        muted
        playsInline
        preload="auto"
        className="block w-full"
        data-testid="screen-playback"
      />
      {props.children}
    </div>
  );
};
