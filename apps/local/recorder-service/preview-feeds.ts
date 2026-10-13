import type http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { PREVIEW_FEEDS, previewPath, type PreviewFeed } from "./protocol";

/**
 * THE PREVIEW FEEDS, as the rig (#1992) ran them: each ffmpeg.exe that sees a
 * picture connects to a feed's TCP port and sends it as mpjpeg; the service
 * keeps reading, never pushing back on ffmpeg, keeps each feed's latest JPEG
 * and tells whoever waits for a frame (the camera opener).
 *
 * A browser pulls a preview one frame at a time (#2144): `GET
 * /preview/<feed>?after=<seq>` answers with the latest JPEG, numbered in its
 * `X-Frame-Seq` header, or waits for the next one when the latest is the one
 * the browser already has (`after`) or is stale. So a browser has at most
 * one frame in flight and is only ever sent the newest: one that draws
 * slowly skips frames instead of queueing them anywhere between ffmpeg and
 * its screen. (A multipart stream, which this replaces, queued them in the
 * socket buffers, unseen.)
 *
 * The `still` feed is not a preview: the camera preview process also sends a
 * few full-size (1280x720) JPEGs a second there, and the service keeps only
 * the latest (`latest`), for the thumbnail camera's still (`GET /still`).
 */

/** Every feed the service listens on: the previews, and the camera's still. */
export type Feed = PreviewFeed | "still";
const FEEDS = [...PREVIEW_FEEDS, "still"] as const satisfies readonly Feed[];

/** How long a pull waits for a frame before answering 204, to be asked again. */
const PULL_WAIT_MS = 5000;

/** A latest frame older than this is not answered at once: the next one is waited for. */
const STALE_MS = 1000;

/** The header that numbers a pulled frame, for the browser's next `after`. */
export const FRAME_SEQ_HEADER = "X-Frame-Seq";

/** Splits an mpjpeg stream into its JPEGs. */
const mpjpegParser = (onJpeg: (jpeg: Buffer) => void) => {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = buffer
        .subarray(0, headerEnd)
        .toString("latin1")
        .match(/Content-length:\s*(\d+)/i)?.[1];
      if (!length) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const end = start + Number(length);
      if (buffer.length < end) return;
      onJpeg(Buffer.from(buffer.subarray(start, end)));
      buffer = buffer.subarray(end);
    }
  };
};

export const startPreviewFeeds = async () => {
  const frameListeners: Record<Feed, Set<() => void>> = {
    camera: new Set(),
    screen: new Set(),
    still: new Set(),
  };
  const latest: Partial<
    Record<Feed, { jpeg: Buffer; atMs: number; seq: number }>
  > = {};
  const sockets = new Set<net.Socket>();
  const pulls = new Set<http.ServerResponse>();
  let seq = 0;

  const frame = (feed: Feed, jpeg: Buffer) => {
    seq += 1;
    latest[feed] = { jpeg, atMs: Date.now(), seq };
    for (const listener of frameListeners[feed]) listener();
  };

  const onFrame = (feed: Feed, listener: () => void) => {
    frameListeners[feed].add(listener);
    return () => void frameListeners[feed].delete(listener);
  };

  const listen = (feed: Feed) =>
    new Promise<net.Server>((resolve, reject) => {
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.on(
          "data",
          mpjpegParser((jpeg) => frame(feed, jpeg))
        );
      });
      server.once("error", reject);
      // An ephemeral port, handed to each ffmpeg.exe in its arguments.
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

  const servers = Object.fromEntries(
    await Promise.all(FEEDS.map(async (f) => [f, await listen(f)] as const))
  ) as Record<Feed, net.Server>;
  const portOf = (feed: Feed) => (servers[feed].address() as AddressInfo).port;

  return {
    /** The TCP port ffmpeg.exe sends a feed's mpjpeg to. */
    port: portOf,

    /** Calls `listener` on each frame of a feed, until unsubscribed. */
    onFrame,

    /** A feed's latest JPEG and when it arrived (`Date.now()` ms), if any came. */
    latest: (feed: Feed) => latest[feed],

    /** Serves `GET /preview/<feed>?after=<seq>` with these CORS headers; false for any other request. */
    serve(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      cors: Record<string, string>
    ) {
      const url = new URL(req.url ?? "/", "http://service");
      const feed = PREVIEW_FEEDS.find((f) => url.pathname === previewPath(f));
      if (!feed || req.method !== "GET") return false;
      const after = url.searchParams.get("after");
      const headers = {
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": FRAME_SEQ_HEADER,
        ...cors,
      };
      const fresh = () => {
        const f = latest[feed];
        return f && String(f.seq) !== after && Date.now() - f.atMs < STALE_MS
          ? f
          : undefined;
      };
      const send = (f: ReturnType<typeof fresh>) => {
        if (!f) {
          res.writeHead(204, headers).end();
          return;
        }
        res.writeHead(200, {
          ...headers,
          "Content-Type": "image/jpeg",
          [FRAME_SEQ_HEADER]: String(f.seq),
        });
        res.end(f.jpeg);
      };
      res.socket?.setNoDelay(true);
      const now = fresh();
      if (now) {
        send(now);
        return true;
      }
      // Wait for the next frame (or give up after a while, to be asked again).
      pulls.add(res);
      const unsubscribe = onFrame(feed, () => {
        stop();
        send(fresh());
      });
      const timer = setTimeout(() => {
        stop();
        send(undefined);
      }, PULL_WAIT_MS);
      const stop = () => {
        unsubscribe();
        clearTimeout(timer);
        pulls.delete(res);
      };
      res.on("close", stop);
      return true;
    },

    async close() {
      for (const res of pulls) res.writeHead(204).end();
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        Object.values(servers).map(
          (s) => new Promise<void>((resolve) => s.close(() => resolve()))
        )
      );
    },
  };
};

export type PreviewFeeds = Awaited<ReturnType<typeof startPreviewFeeds>>;
