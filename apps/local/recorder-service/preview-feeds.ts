import type http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { PREVIEW_FEEDS, previewPath, type PreviewFeed } from "./protocol";

/**
 * THE PREVIEW FEEDS, as the rig (#1992) ran them: each ffmpeg.exe that sees a
 * picture connects to a feed's TCP port and sends it as mpjpeg; the service
 * keeps reading, never pushing back on ffmpeg, and passes each JPEG to the
 * browsers watching (`GET /preview/<feed>`) and to whoever waits for a frame
 * (the camera opener). A browser that falls behind skips frames instead of
 * queueing them.
 */

const BOUNDARY = "cvmpreviewframe";

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
  const watchers: Record<PreviewFeed, Set<http.ServerResponse>> = {
    camera: new Set(),
    screen: new Set(),
  };
  const frameListeners: Record<PreviewFeed, Set<() => void>> = {
    camera: new Set(),
    screen: new Set(),
  };
  const sockets = new Set<net.Socket>();

  const frame = (feed: PreviewFeed, jpeg: Buffer) => {
    for (const listener of frameListeners[feed]) listener();
    const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`;
    for (const res of watchers[feed]) {
      if (res.writableLength > 2 * jpeg.length) continue;
      res.write(head);
      res.write(jpeg);
      res.write("\r\n");
    }
  };

  const listen = (feed: PreviewFeed) =>
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

  const servers = {
    camera: await listen("camera"),
    screen: await listen("screen"),
  };
  const portOf = (feed: PreviewFeed) =>
    (servers[feed].address() as AddressInfo).port;

  return {
    /** The TCP port ffmpeg.exe sends a feed's mpjpeg to. */
    port: portOf,

    /** Calls `listener` on each frame of a feed, until unsubscribed. */
    onFrame(feed: PreviewFeed, listener: () => void) {
      frameListeners[feed].add(listener);
      return () => void frameListeners[feed].delete(listener);
    },

    /** Serves `GET /preview/<feed>`; false for any other request. */
    serve(req: http.IncomingMessage, res: http.ServerResponse) {
      const feed = PREVIEW_FEEDS.find((f) => req.url === previewPath(f));
      if (!feed) return false;
      res.writeHead(200, {
        "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.socket?.setNoDelay(true);
      watchers[feed].add(res);
      req.on("close", () => watchers[feed].delete(res));
      return true;
    },

    async close() {
      for (const set of Object.values(watchers))
        for (const res of set) res.end();
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
