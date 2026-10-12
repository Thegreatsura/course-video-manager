// Entry point (public, browser-safe) for the clip-source package.
//
// A deep module answering one question: "how do I get this Clip's picture and
// sound?" Editor playback, stills, the Article Writer's screenshot picker, the
// export and its Export Hash, the vertical render, Export to DaVinci Resolve
// and Clip transcription all ask it, instead of reading the Clip's Footage path
// column themselves.
//
// Two answers, behind the same functions: a single Footage file with a start
// and end time (an OBS Clip), or a Recording Session's camera, screen and mic
// files with the scene segments the layout module draws and the mic offset (a
// CVM-recorder Clip, when the row is loaded with its `recordingSession`).
// `clipComposite` says what the export draws for a CVM-recorder Clip.
export {
  clipComposite,
  clipCompositePicture,
  clipFfmpegInput,
  clipFrame,
  clipFrameFfmpegArgs,
  clipPlaybackClock,
  clipPlaybackUrl,
  sceneAt,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
  type ClipComposite,
  type ClipFfmpegInput,
  type ClipFrame,
  type ClipRecordingSession,
  type ClipSource,
  type ClipSourceColumns,
  type ClipSourceRow,
} from "./lib/clip-source";
