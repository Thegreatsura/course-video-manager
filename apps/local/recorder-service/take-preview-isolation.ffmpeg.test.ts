import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordedAndPreviewed } from "./capture-args";

/**
 * A preview must never stop or change a recording (#2203). During a take the
 * camera preview is camera.mkv's own packets, teed to the feed
 * (`recordedAndPreviewed`). Here the real ffmpeg (Linux, libx264: CI has no
 * GPU) records a synthetic picture through it while the preview's consumer
 * dies, stalls, or was never there, and the file must come out whole and
 * packet for packet what a plain matroska output writes.
 */

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const FRAMES = 90;

/** Three seconds of a synthetic picture at 30 fps, read in real time; B-frames, as camera.mkv has. */
const INPUT = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-re",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=30",
  "-frames:v",
  String(FRAMES),
  "-map",
  "0:v",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-bf",
  "2",
  "-g",
  "60",
  "-threads",
  "1",
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const ffmpeg = (args: string[]) =>
  new Promise<number | null>((resolve) =>
    spawn("ffmpeg", args, { stdio: "ignore" }).once("exit", resolve)
  );

/** The file's packets, as framemd5 hashes them (stream copy: no decode). */
const packets = (file: string) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-c",
    "copy",
    "-f",
    "framemd5",
    "-",
  ])
    .toString()
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));

/** A preview consumer that reads for `readMs`, then dies or stops reading. */
const consumer = async (o: { after: "dies" | "stalls"; readMs: number }) => {
  let read = 0;
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("data", (d) => (read += d.length));
    socket.on("error", () => {});
    setTimeout(() => {
      if (o.after === "dies") {
        socket.destroy();
        server.close();
      } else socket.pause();
    }, o.readMs);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    read: () => read,
    close: () => {
      sockets.forEach((s) => s.destroy());
      server.close();
    },
  };
};

const unusedPort = async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((r) => server.close(r));
  return port;
};

describe.skipIf(!hasFfmpeg)(
  "a take's camera preview, in the real ffmpeg",
  () => {
    it.each([
      ["dies mid-take", "dies"],
      ["stalls mid-take (connected, never reading)", "stalls"],
      ["is never there", "absent"],
    ] as const)(
      "leaves camera.mkv whole and unchanged when its consumer %s",
      async (_, mode) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-preview-"));
        dirs.push(dir);
        const plain = path.join(dir, "plain.mkv");
        const teed = path.join(dir, "camera.mkv");
        const feed =
          mode === "absent"
            ? undefined
            : await consumer({ after: mode, readMs: 1000 });
        try {
          const [plainExit, teedExit] = await Promise.all([
            ffmpeg([
              ...INPUT,
              "-flags",
              "+global_header",
              "-cluster_time_limit",
              "1000",
              "-flush_packets",
              "1",
              "-f",
              "matroska",
              plain,
            ]),
            ffmpeg([
              ...INPUT,
              ...recordedAndPreviewed(teed, feed?.port ?? (await unusedPort())),
            ]),
          ]);
          expect(plainExit).toBe(0);
          expect(teedExit).toBe(0);
          if (feed) expect(feed.read()).toBeGreaterThan(0);
          const recorded = packets(teed);
          expect(recorded).toHaveLength(FRAMES);
          expect(recorded).toEqual(packets(plain));
        } finally {
          feed?.close();
        }
      },
      20_000
    );
  }
);
