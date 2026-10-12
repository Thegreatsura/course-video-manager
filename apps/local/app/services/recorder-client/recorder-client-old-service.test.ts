import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { setupClipServiceTests, clipService } from "../clip-service-test-setup";
import {
  connectClient,
  startService,
  tmp,
} from "./recorder-client-test-harness";

/**
 * The app after a pull, against a recorder service still running from
 * before it (the service outlives app restarts, ADR 0034). The "old
 * service" is the real one behind a proxy that drops fields it never sent.
 */

setupClipServiceTests();

const proxies: WebSocketServer[] = [];
afterEach(async () => {
  for (const p of proxies.splice(0)) {
    for (const c of p.clients) c.terminate();
    await new Promise<void>((r) => p.close(() => r()));
  }
});

/** Forwards to the service, deleting `drop` from each message and its state. */
const proxy = async (servicePort: number, drop: string[]) => {
  const wss = new WebSocketServer({ port: 0 });
  proxies.push(wss);
  wss.on("connection", (client) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${servicePort}`);
    const pending: string[] = [];
    upstream.on("open", () =>
      pending.splice(0).forEach((d) => upstream.send(d))
    );
    client.on("message", (d) =>
      upstream.readyState === WebSocket.OPEN
        ? upstream.send(d.toString())
        : pending.push(d.toString())
    );
    upstream.on("message", (d) => {
      const m = JSON.parse(d.toString());
      for (const key of drop) {
        delete m[key];
        if (m.state) delete m.state[key];
      }
      client.send(JSON.stringify(m));
    });
    client.on("close", () => upstream.close());
    upstream.on("close", () => client.close());
  });
  await new Promise((r) => wss.once("listening", r));
  return (wss.address() as { port: number }).port;
};

const recordLandscape = (
  client: ReturnType<typeof connectClient>,
  id: string
) =>
  client.startRecording(id, {
    silenceLength: "short",
    insertionPoint: { type: "start" },
    folder: tmp(),
    format: "landscape",
  });

describe("the recorder client against an older recorder service", () => {
  it("says to restart a service that greets without the protocol version, and refuses Record with that", async () => {
    const { port } = await startService();
    const client = connectClient(
      await proxy(port, ["protocol", "format", "screen"])
    );
    const video = await clipService.createVideo("Landscape");
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({
          type: "recorder-status",
          problem: expect.stringMatching(
            /^The recorder service is running older code: restart it\..*kill <pid>.*\/health.*pnpm dev/
          ),
        })
      )
    );
    await expect(recordLandscape(client, video.id)).rejects.toThrow(
      /running older code/
    );
  });

  it("reads a state without a format as Landscape", async () => {
    const { port } = await startService();
    const client = connectClient(await proxy(port, ["format", "screen"]));
    const video = await clipService.createVideo("Landscape");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() => recordLandscape(client, video.id), {
      timeout: 5_000,
    });
  });
});
