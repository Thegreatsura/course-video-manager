// Entry point (public, browser-safe) for the clip-source package.
//
// A deep module answering one question: "how do I get this Clip's picture and
// sound?" Editor playback, stills, the Article Writer's screenshot picker, the
// export and its Export Hash, the vertical render, Export to DaVinci Resolve
// and Clip transcription all ask it, instead of reading the Clip's Footage path
// column themselves.
//
// Two answers: an OBS Clip is a single Footage file with a start and end time;
// a new-recorder Clip is its Recording Session's composite (screen + camera in
// its scenes, mic shifted by the mic offset) — `clipComposite` says what the
// export draws. Which answer a Clip has is decided inside `lib/`, not in the
// readers.
export {
  clipComposite,
  clipFfmpegInput,
  clipFrame,
  clipPlaybackUrl,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
  type ClipComposite,
  type ClipFfmpegInput,
  type ClipFrame,
  type ClipSource,
  type ClipSourceColumns,
  type ClipSourceRow,
  type RecordingSessionColumns,
} from "./lib/clip-source";
