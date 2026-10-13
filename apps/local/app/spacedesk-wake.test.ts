import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  SPACEDESK_DEFAULT_PORT,
  SPACEDESK_HOST,
  SpacedeskWakeError,
  spacedeskAddress,
  wakeSpacedesk,
} from "./spacedesk-wake";

/** Unmask the client's one binary frame (16-bit length form). */
const unmask = (frame: Buffer): Buffer => {
  const len = frame.readUInt16BE(2);
  const mask = frame.subarray(4, 8);
  const body = frame.subarray(8, 8 + len);
  return Buffer.from(body.map((b, i) => b ^ mask[i & 3]!));
};

/** A loopback stand-in for the spacedesk server: upgrades, then streams. */
const fakeSpacedesk = () => {
  const packets: Buffer[] = [];
  const server = net.createServer((socket) => {
    let upgraded = false;
    socket.on("data", (chunk) => {
      if (!upgraded) {
        upgraded = true;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
        );
        return;
      }
      packets.push(unmask(chunk));
      socket.write(Buffer.from([0x82, 0x01, 0x00]));
    });
  });
  return { server, packets };
};

let server: net.Server | undefined;
afterEach(() => server?.close());

describe("wakeSpacedesk", () => {
  it("sends the 462-byte identification packet and resolves on the first frame", async () => {
    const fake = fakeSpacedesk();
    server = fake.server;
    await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
    const { port } = fake.server.address() as net.AddressInfo;

    await wakeSpacedesk({ host: "127.0.0.1", port });

    const [packet] = fake.packets;
    expect(packet).toHaveLength(462);
    expect([0, 4, 8, 12, 16, 48].map((o) => packet!.readInt32LE(o))).toEqual([
      0, 334, 4, 8, 1, 2,
    ]);
    // The client and custom resolutions: both the Short's 1080x1080 square.
    expect([52, 88, 56, 92].map((o) => packet!.readInt32LE(o))).toEqual([
      1080, 1080, 1080, 1080,
    ]);
  });

  it("rejects with a SpacedeskWakeError when nothing listens", async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const { port } = closed.address() as net.AddressInfo;
    await new Promise<void>((r) => closed.close(() => r()));

    await expect(
      wakeSpacedesk({ host: "127.0.0.1", port })
    ).rejects.toBeInstanceOf(SpacedeskWakeError);
  });

  it("rejects with a SpacedeskWakeError when the server closes before the upgrade", async () => {
    server = net.createServer((socket) =>
      socket.once("data", () => socket.end())
    );
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const { port } = server.address() as net.AddressInfo;

    const woken = wakeSpacedesk({ host: "127.0.0.1", port });
    await expect(woken).rejects.toBeInstanceOf(SpacedeskWakeError);
    await expect(woken).rejects.toThrow(
      "spacedesk closed the connection before the handshake"
    );
  });

  it("targets the PC's fixed host, with the port overridable from the env", () => {
    expect(spacedeskAddress({})).toEqual({
      host: SPACEDESK_HOST,
      port: SPACEDESK_DEFAULT_PORT,
    });
    expect(spacedeskAddress({ SPACEDESK_PORT: "1" }).port).toBe(1);
  });
});
