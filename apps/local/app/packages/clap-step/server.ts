// Entry point (public, server-only: it runs ffmpeg) for the clap-step
// package: the mic's samples over a window, one camera frame as a JPEG, and
// Play's short clip with the Mic Offset applied. The camera decodes on the GPU
// (NVDEC) and Play's clip encodes on NVENC, each falling back to the CPU when
// there is no usable GPU; each one request the page waits on.
export {
  ClapStepFfmpegError,
  cameraFrameJpeg,
  clapPreviewMp4,
  readMicSamples,
} from "./lib/ffmpeg";
export { frameMs } from "./lib/clap-step";
