import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPreviewFeeds, type PreviewFeeds } from "./preview-feeds";

/**
 * A browser pulls a preview a frame at a time (#2144): the newest frame, or
 * a wait for the next one, so it never has more than one in flight and is
 * never sent a backlog.
 */

let feeds: PreviewFeeds | undefined;
let server: http.Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  server?.close();
  await feeds?.close();
});

const start = async () => {
  feeds = await startPreviewFeeds();
  const f = feeds;
  server = http.createServer((req, res) => {
    if (!f.serve(req, res, {})) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const ffmpeg = net.connect(f.port("camera"), "127.0.0.1");
  await new Promise((r) => ffmpeg.once("connect", r));
  const send = async (body: string) => {
    const jpeg = Buffer.from(body);
    const before = f.latest("camera")?.seq;
    ffmpeg.write(
      `--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-length: ${jpeg.length}\r\n\r\n`
    );
    ffmpeg.write(jpeg);
    ffmpeg.write("\r\n");
    await vi.waitFor(() => expect(f.latest("camera")?.seq).not.toBe(before));
  };
  const pull = (after = "") =>
    new Promise<{ status: number; seq: string; body: string }>((resolve) => {
      http.get(
        `http://127.0.0.1:${port}/preview/camera?after=${after}`,
        (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              seq: String(res.headers["x-frame-seq"]),
              body,
            })
          );
        }
      );
    });
  return { send, pull, ffmpeg };
};

describe("a pulled preview", () => {
  it("answers with the newest frame, skipping any the browser did not ask for", async () => {
    const { send, pull, ffmpeg } = await start();
    await send("one");
    await send("two");
    await send("three");
    const first = await pull();
    expect(first).toMatchObject({ status: 200, body: "three" });
    ffmpeg.destroy();
  });

  it("waits for the next frame when the browser has the newest", async () => {
    const { send, pull, ffmpeg } = await start();
    await send("one");
    const first = await pull();
    const next = pull(first.seq);
    let answered = false;
    void next.then(() => (answered = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(answered).toBe(false);
    await send("two");
    expect(await next).toMatchObject({ status: 200, body: "two" });
    ffmpeg.destroy();
  });

  it("does not answer at once with a stale frame", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { send, pull, ffmpeg } = await start();
      await send("old");
      vi.setSystemTime(Date.now() + 5000);
      const next = pull();
      let answered = false;
      void next.then(() => (answered = true));
      await new Promise((r) => setTimeout(r, 50));
      expect(answered).toBe(false);
      await send("new");
      expect(await next).toMatchObject({ status: 200, body: "new" });
      ffmpeg.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
