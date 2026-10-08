import { describe, it, expect } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import { ConfigProvider, Effect, Either, Layer, Logger } from "effect";
import {
  BUFFER_AUTH_ERROR_MESSAGE,
  BufferApiService,
} from "@/services/buffer-api-service.server";

const TOKEN = "secret-buffer-token-abc123";

// Buffer's real reply to an expired personal key (2026-10-08).
const EXPIRED_KEY_BODY = JSON.stringify({
  errors: [
    {
      message: "Access token is not valid",
      extensions: { code: "UNAUTHENTICATED" },
    },
  ],
});

const stubBuffer = (status: number, body: string) => {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs against the real service, built from config, with its logs captured. */
const withService = <A, E>(
  use: (api: BufferApiService) => Effect.Effect<A, E>
) => {
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => {
    logs.push(Array.isArray(message) ? message.join(" ") : String(message));
  });
  const layer = Layer.mergeAll(
    BufferApiService.Default,
    Logger.replace(Logger.defaultLogger, logger)
  ).pipe(
    Layer.provide(
      Layer.setConfigProvider(
        ConfigProvider.fromMap(new Map([["BUFFER_API_TOKEN", TOKEN]]))
      )
    )
  );
  return Effect.gen(function* () {
    const api = yield* BufferApiService;
    const result = yield* Effect.either(use(api));
    return { error: Either.isLeft(result) ? result.left : undefined, logs };
  }).pipe(Effect.provide(layer));
};

describe("BufferApiService", () => {
  it.effect.each([
    { name: "an HTTP 401", status: 401, body: EXPIRED_KEY_BODY },
    {
      name: "an UNAUTHENTICATED GraphQL error on a 200",
      status: 200,
      body: EXPIRED_KEY_BODY,
    },
  ])("turns $name into a BufferAuthError that says how to fix it", (c) =>
    Effect.gen(function* () {
      stubBuffer(c.status, c.body);

      const { error } = yield* withService((api) =>
        api.createPost({ channelId: "ch", text: "hi", videoUrl: "https://x" })
      );

      expect(error).toMatchObject({
        _tag: "BufferAuthError",
        message: BUFFER_AUTH_ERROR_MESSAGE,
      });
    })
  );

  it.effect("logs a failure's status and body, never the token", () =>
    Effect.gen(function* () {
      // A body that echoes the key back must not carry it into the log.
      stubBuffer(
        500,
        JSON.stringify({ errors: [{ message: `bad token ${TOKEN}` }] })
      );

      const { error, logs } = yield* withService((api) =>
        api.createPost({ channelId: "ch", text: "hi", videoUrl: "https://x" })
      );

      const log = logs.join("\n");
      expect(log).toContain("HTTP 500");
      expect(log).toContain("bad token [REDACTED]");
      expect(log).not.toContain(TOKEN);
      expect(error?.message).not.toContain(TOKEN);
    })
  );

  describe("verifyAuth (the pre-flight)", () => {
    it.effect("fails fast with BufferAuthError on an expired key", () =>
      Effect.gen(function* () {
        stubBuffer(401, EXPIRED_KEY_BODY);

        const { error } = yield* withService((api) => api.verifyAuth());

        expect(error?._tag).toBe("BufferAuthError");
      })
    );

    it.effect("lets posting go ahead when the key lacks accountRead", () =>
      Effect.gen(function* () {
        stubBuffer(
          200,
          JSON.stringify({
            errors: [
              {
                message: "Missing required scope: accountRead",
                extensions: { code: "FORBIDDEN" },
              },
            ],
          })
        );

        const { error } = yield* withService((api) => api.verifyAuth());

        expect(error).toBeUndefined();
      })
    );
  });
});
