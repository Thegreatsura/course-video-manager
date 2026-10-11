// Entry point (public, browser-safe) for the clip-source package.
//
// A deep module answering one question: "how do I get this Clip's picture and
// sound?" Editor playback, stills, the Article Writer's screenshot picker, the
// export and its Export Hash, the vertical render, Export to DaVinci Resolve
// and Clip transcription all ask it, instead of reading the Clip's Footage path
// column themselves.
//
// Today every Clip has one answer — a single Footage file with a start and end
// time (an OBS Clip). A second kind of source belongs inside `lib/`, behind
// these same functions, not in the readers.
export {
  clipFfmpegInput,
  clipFrame,
  clipPlaybackUrl,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
  type ClipFfmpegInput,
  type ClipFrame,
  type ClipSource,
  type ClipSourceColumns,
} from "./lib/clip-source";
