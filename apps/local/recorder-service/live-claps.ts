import fs from "node:fs";
import {
  hearClaps,
  type ClapMark,
  type MotionPoint,
} from "../app/packages/clap-detection/live";
import type { CalibrationWindow } from "./protocol";

/**
 * THE LIVE CLAP MARKS (#2121): during an AV Calibration's clap step, each
 * clap as the mic hears it, and whether the camera saw its contact. The run's
 * capture writes the mic to its WAV file and prints the camera's motion to
 * its log (`calibrationCaptureArgs`); on every meter reading (100 ms) this
 * reads the WAV's new samples in the clap window and runs the clap rules
 * (`hearClaps`, the offline detector's own) over everything that has
 * arrived. So a mark shows about 0.1-0.3 s after the clap (a clap must die
 * away before it counts), its "seen" once the camera's frames around it are
 * in, and the claps marked seen at the end are the ones the result finds.
 */

/** Where the samples start in a WAV, and how they are laid out. */
export type WavLayout = {
  dataOffset: number;
  channels: number;
  sampleRate: number;
};

/**
 * The layout of a 16-bit PCM WAV from its first bytes, once they hold the
 * header (ffmpeg writes `fmt `, then a LIST of the metadata, then `data`,
 * whose size it fills in only at the end).
 */
export const readWavLayout = (head: Buffer): WavLayout | undefined => {
  if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF")
    return undefined;
  let at = 12;
  let fmt: Omit<WavLayout, "dataOffset"> | undefined;
  while (at + 8 <= head.length) {
    const id = head.toString("ascii", at, at + 4);
    const size = head.readUInt32LE(at + 4);
    if (id === "data") return fmt ? { ...fmt, dataOffset: at + 8 } : undefined;
    if (id === "fmt ") {
      if (at + 24 > head.length) return undefined;
      if (head.readUInt16LE(at + 22) !== 16) return undefined;
      fmt = {
        channels: head.readUInt16LE(at + 10),
        sampleRate: head.readUInt32LE(at + 12),
      };
    }
    at += 8 + size + (size % 2);
  }
  return undefined;
};

const HEAD_BYTES = 4096;

export type LiveClaps = {
  /** A frame's motion, from the capture's log. */
  addMotion: (point: MotionPoint) => void;
  /** Reads what the mic file has gained and marks the claps again. */
  update: () => void;
  /** Lets the mic file go. */
  stop: () => void;
};

export const createLiveClaps = (o: {
  /** The run's mic file (WSL path), as the capture writes it. */
  micFile: string;
  /** The clap window, in seconds of the run's files. */
  window: CalibrationWindow;
  /** The marks, whenever they change. */
  onMarks: (marks: ClapMark[]) => void;
}): LiveClaps => {
  let fd: number | undefined;
  let layout: WavLayout | undefined;
  /** Bytes of samples read so far (from `dataOffset`). */
  let read = 0;
  /** The mic, mono, from the window's start: `filled` of it so far. */
  let samples = new Float32Array(0);
  let filled = 0;
  let firstSample = 0;
  let lastSample = 0;
  const motion: MotionPoint[] = [];
  let shown = "[]";
  /** The motion the marks were last worked out over. */
  let marked = 0;
  let stopped = false;

  const open = () => {
    if (fd !== undefined) return fd;
    try {
      fd = fs.openSync(o.micFile, "r");
    } catch {
      return undefined;
    }
    return fd;
  };

  const readLayout = (file: number) => {
    const head = Buffer.alloc(HEAD_BYTES);
    const got = fs.readSync(file, head, 0, HEAD_BYTES, 0);
    layout = readWavLayout(head.subarray(0, got));
    if (!layout) return;
    firstSample = Math.round(o.window.startSeconds * layout.sampleRate);
    lastSample = Math.round(o.window.endSeconds * layout.sampleRate);
    samples = new Float32Array(lastSample - firstSample);
  };

  /** Appends the new whole frames, as ffmpeg downmixes them to mono. */
  const readSamples = (file: number, l: WavLayout) => {
    const frameBytes = 2 * l.channels;
    const size = fs.fstatSync(file).size - l.dataOffset;
    const frames = Math.floor((size - read) / frameBytes);
    if (frames <= 0) return;
    const bytes = Buffer.alloc(frames * frameBytes);
    fs.readSync(file, bytes, 0, bytes.length, l.dataOffset + read);
    const firstFrame = read / frameBytes;
    read += bytes.length;
    for (let f = 0; f < frames; f++) {
      const n = firstFrame + f - firstSample;
      if (n < 0) continue;
      if (n >= samples.length) break;
      let sum = 0;
      for (let c = 0; c < l.channels; c++)
        sum += bytes.readInt16LE(f * frameBytes + 2 * c);
      samples[n] = sum / l.channels / 32768;
      filled = n + 1;
    }
  };

  return {
    addMotion: (point) => {
      if (
        point.seconds >= o.window.startSeconds &&
        point.seconds <= o.window.endSeconds
      )
        motion.push(point);
    },
    update: () => {
      if (stopped) return;
      const file = open();
      if (file === undefined) return;
      if (!layout) readLayout(file);
      if (!layout) return;
      const full = filled === samples.length;
      // The window's mic is all in: only the camera's late frames are new.
      if (full && motion.length === marked) return;
      if (!full) readSamples(file, layout);
      if (filled === 0) return;
      marked = motion.length;
      const { marks } = hearClaps({
        samples: samples.subarray(0, filled),
        sampleRate: layout.sampleRate,
        startSeconds: firstSample / layout.sampleRate,
        motion,
      });
      const key = JSON.stringify(marks);
      if (key === shown) return;
      shown = key;
      o.onMarks(marks);
    },
    stop: () => {
      stopped = true;
      if (fd !== undefined) fs.closeSync(fd);
      fd = undefined;
    },
  };
};
