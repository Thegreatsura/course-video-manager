// Entry point (public, server-only: it runs ffmpeg) for the clap-step
// package: the mic's samples over a window, one camera frame as a JPEG, and
// Play's short clip with the Mic Offset applied. All on the CPU (libx264),
// never the GPU, and each one request the page waits on.
export {
  ClapStepFfmpegError,
  cameraFrameJpeg,
  clapPreviewMp4,
  readMicSamples,
} from "./lib/ffmpeg";
export { frameMs } from "./lib/clap-step";
