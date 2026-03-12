import { Button } from "@/components/ui/button";
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  LoaderIcon,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import type { IndexedClip } from "./types";

export interface ChooseScreenshotProps {
  clipIndex: number;
  alt: string;
  clips: IndexedClip[];
  onClipIndexChange: (currentIndex: number, newIndex: number) => void;
  onCapture: (
    clipIndex: number,
    alt: string,
    timestamp: number,
    videoFilename: string
  ) => void;
  isCapturing?: boolean;
}

export function ChooseScreenshot({
  clipIndex,
  alt,
  clips,
  onClipIndexChange,
  onCapture,
  isCapturing,
}: ChooseScreenshotProps) {
  const clip = clips.find((c) => c.index === clipIndex);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const isFirstClip = clipIndex <= 1;
  const isLastClip = clipIndex >= clips.length;

  useEffect(() => {
    if (clip && videoRef.current) {
      videoRef.current.currentTime = clip.sourceStartTime;
      setCurrentTime(clip.sourceStartTime);
    }
  }, [clip?.sourceStartTime]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !clip) return;
    const time = videoRef.current.currentTime;
    // Clamp to clip boundaries
    if (time < clip.sourceStartTime) {
      videoRef.current.currentTime = clip.sourceStartTime;
    } else if (time > clip.sourceEndTime) {
      videoRef.current.currentTime = clip.sourceEndTime;
    }
    setCurrentTime(videoRef.current.currentTime);
  }, [clip]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current || !clip) return;
      const time = parseFloat(e.target.value);
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    },
    [clip]
  );

  if (!clip) {
    return (
      <div className="my-4 rounded-lg border border-destructive bg-destructive/10 p-4">
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

  return (
    <div className="my-4 rounded-lg border border-border bg-muted/50 p-4">
      <p className="mb-2 text-xs text-muted-foreground">
        Clip {clipIndex} — {alt}
      </p>
      <video
        ref={videoRef}
        src={`/view-video?videoPath=${encodeURIComponent(clip.videoFilename)}#t=${clip.sourceStartTime},${clip.sourceEndTime}`}
        className="w-full rounded-md"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            videoRef.current.currentTime = clip.sourceStartTime;
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatTime(currentTime - clip.sourceStartTime)}
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
          {formatTime(duration)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isFirstClip}
          onClick={() => onClipIndexChange(clipIndex, clipIndex - 1)}
        >
          <ChevronLeftIcon className="h-3 w-3 mr-1" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLastClip}
          onClick={() => onClipIndexChange(clipIndex, clipIndex + 1)}
        >
          Next
          <ChevronRightIcon className="h-3 w-3 ml-1" />
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          disabled={isCapturing}
          onClick={() =>
            onCapture(clipIndex, alt, currentTime, clip.videoFilename)
          }
        >
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

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
