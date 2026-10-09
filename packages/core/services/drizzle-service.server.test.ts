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
});
