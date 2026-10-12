import { useEffect, useRef, type ReactNode } from "react";
import { CheckIcon, Loader2, MicIcon, MicOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveMediaStreamProps } from "../types";
import type { FrontendSpeechDetectorState } from "../use-speech-detector";

/**
 * The live picture's frame, whichever Recorder fills it: the capture badge
 * (recording state and speech detection), the ring coloured to match, and
 * the optional centre line for camera framing. `children` is the picture.
 *
 * `showCaptureStatus` false turns the badge and ring off wholesale —
 * recording and idle alike — so the teleprompter is the only screen
 * reporting the take.
 */
export const CaptureFrame = (props: {
  isRecording: boolean;
  speechDetectorState: FrontendSpeechDetectorState;
  showCenterLine: boolean;
  showCaptureStatus: boolean;
  children: ReactNode;
}) => {
  const showRecordingStatus = props.showCaptureStatus && props.isRecording;
  const showIdleStatus = props.showCaptureStatus && !props.isRecording;
  const speech = props.speechDetectorState.type;

  return (
    <div className={cn("relative w-full h-full")}>
      <div
        className={cn(
          "w-full h-full",
          "ring-4",
          "ring-muted-foreground",
          "rounded-lg",
          showRecordingStatus &&
            speech === "speaking-detected" &&
            "ring-yellow-600",
          showRecordingStatus &&
            speech === "long-enough-speaking-for-clip-detected" &&
            "ring-green-600",
          showRecordingStatus && speech === "silence" && "ring-blue-600",
          showRecordingStatus && speech === "warming-up" && "ring-red-600"
        )}
      >
        {props.children}
      </div>
      {showRecordingStatus && speech === "silence" && (
        <div className="absolute top-4 left-4 bg-blue-600 rounded-full size-8 flex items-center justify-center">
          <CheckIcon className="size-4 text-white" />
        </div>
      )}
      {showRecordingStatus && speech === "speaking-detected" && (
        <div className="absolute top-4 left-4 bg-yellow-600 rounded-full size-8 flex items-center justify-center">
          <MicIcon className="size-4 text-white" />
        </div>
      )}
      {showRecordingStatus &&
        speech === "long-enough-speaking-for-clip-detected" && (
          <div className="absolute top-4 left-4 bg-green-600 rounded-full size-8 flex items-center justify-center">
            <MicIcon className="size-4 text-white" />
          </div>
        )}
      {showRecordingStatus && speech === "warming-up" && (
        <div className="absolute top-4 left-4 bg-red-600 rounded-full size-8 flex items-center justify-center">
          <Loader2 className="size-4 text-white animate-spin" />
        </div>
      )}
      {showIdleStatus && (
        <div className="absolute top-4 left-4 bg-muted rounded-full size-8 flex items-center justify-center">
          <MicOffIcon className="size-4 text-foreground" />
        </div>
      )}
      {props.showCenterLine && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="border-l-2 border-dashed border-muted-foreground/50 h-full"></div>
        </div>
      )}
    </div>
  );
};

/**
 * OBS's live picture: the Virtual Camera's stream in the capture frame.
 * Auto-plays the stream when mounted or when the stream changes.
 */
export const LiveMediaStream = (props: LiveMediaStreamProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = props.mediaStream;
      videoRef.current.play();
    }
  }, [props.mediaStream, videoRef.current]);

  return (
    <CaptureFrame
      isRecording={props.obsConnectorState.type === "obs-recording"}
      speechDetectorState={props.speechDetectorState}
      showCenterLine={props.showCenterLine}
      showCaptureStatus={props.showCaptureStatus}
    >
      <video
        ref={videoRef}
        muted
        className="w-full h-full object-contain rounded-lg"
      />
    </CaptureFrame>
  );
};
