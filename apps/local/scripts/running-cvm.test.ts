import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRunningCvm } from "./running-cvm";

const servers: net.Server[] = [];
const listen = (at: number | string) =>
  new Promise<net.Server>((resolve) => {
    const server = net.createServer((s) => s.destroy());
    servers.push(server);
    server.listen(at, () => resolve(server));
  });

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r)))
  );
});

describe("findRunningCvm", () => {
  it("names the app server and the Sidecar when both answer", async () => {
    const app = await listen(0);
    const appPort = (app.address() as net.AddressInfo).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "running-cvm-"));
    const sidecarSocket = path.join(dir, "sidecar.sock");
    await listen(sidecarSocket);

    expect(await findRunningCvm({ appPort, sidecarSocket })).toEqual([
      `the app server on port ${appPort}`,
      `the Sidecar on ${sidecarSocket}`,
    ]);
  });

  it("finds nothing when nothing listens (a stale socket file included)", async () => {
    const app = await listen(0);
    const appPort = (app.address() as net.AddressInfo).port;
    await new Promise((r) => app.close(r));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "running-cvm-"));
    const sidecarSocket = path.join(dir, "sidecar.sock");
    fs.writeFileSync(sidecarSocket, "");

    expect(await findRunningCvm({ appPort, sidecarSocket })).toEqual([]);
  });
});
