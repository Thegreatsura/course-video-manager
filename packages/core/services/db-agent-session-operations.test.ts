import { describe, it, expect, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { AgentSessionOperationsService } from "./db-agent-session-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { createTestDb, type TestDb } from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";

/**
 * The API's own check on an Agent Session upload. The `cvm` reader never
 * reads a skill's body or a tool's result into an entry, but the API is the
 * gate every write passes, so an entry that arrives carrying either is refused
 * there too — and nothing is stored.
 */

let testDb: TestDb;
let layer: Layer.Layer<AgentSessionOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  layer = AgentSessionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

describe("setVideoAgentSessions", () => {
  it("refuses an entry carrying a skill body or a tool result", async () => {
    const [video] = await testDb
      .insert(schema.videos)
      .values({ title: "v.mp4", originalFootagePath: "" })
      .returning();
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: "2026-01-15_10-00-00.mkv",
      sourceStartTime: 0,
      sourceEndTime: 60,
      order: "a0",
      text: "",
    });
    const wallClockMs = Date.UTC(2026, 0, 15, 10, 0, 10);
    const entries = [
      {
        kind: "skillCall",
        via: "toolCall",
        skill: "tdd",
        args: null,
        skillBody: "# TDD",
        wallClockMs,
      },
      {
        kind: "toolCall",
        tool: "Bash",
        summary: null,
        resultIsError: false,
        result: "ok",
        wallClockMs,
      },
    ];

    const error = await Effect.runPromise(
      Effect.flatMap(AgentSessionOperationsService, (svc) =>
        // Over the wire anything can arrive: the shape is the check's input.
        svc.setVideoAgentSessions(video!.id, [
          { sourceSessionId: "s", entries: entries as never },
        ])
      ).pipe(Effect.flip, Effect.provide(layer))
    );

    expect(error).toMatchObject({
      _tag: "AgentSessionUploadRefusedError",
      reasons: [
        "session s entry 1 (skillCall) carries a skillBody, which is never stored",
        "session s entry 2 (toolCall) carries a result, which is never stored",
      ],
    });
    expect(await testDb.select().from(schema.agentSessionEntries)).toEqual([]);
  });
});
