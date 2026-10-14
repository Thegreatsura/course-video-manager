import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { makeConnectionPool } from "./drizzle-service.server.js";

describe("the connection pool", () => {
  it("survives a pooled connection the database drops while it sits idle", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // Nothing listens on port 1: the pool never connects in this test.
    const pool = makeConnectionPool("postgres://cvm:cvm@127.0.0.1:1/cvm");
    // What pg-pool emits when an idle client's socket closes under it.
    expect(() =>
      pool.emit("error", new Error("Connection terminated unexpectedly"))
    ).not.toThrow();
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("Connection terminated unexpectedly")
    );
    quiet.mockRestore();
    await pool.end();
  });

  it("survives a connection the database drops while it is checked out (#2170)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = makeConnectionPool("postgres://cvm:cvm@127.0.0.1:1/cvm");
    // pg-pool emits `connect` with each new Client, then takes its own idle
    // listener off while the Client is checked out: only ours is left.
    const client = new EventEmitter();
    pool.emit("connect", client);
    expect(client.listenerCount("error")).toBe(1);
    expect(() =>
      client.emit("error", new Error("Connection terminated unexpectedly"))
    ).not.toThrow();
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("a connection in use dropped")
    );
    quiet.mockRestore();
    await pool.end();
  });
});
