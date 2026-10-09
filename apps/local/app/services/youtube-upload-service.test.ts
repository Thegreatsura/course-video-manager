import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Fiber } from "effect";
import { SidecarContextTest } from "@/services/sidecar-context";

const FAKE_UPLOAD_URI =
  "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc123";

let capturedFetchCalls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  capturedFetchCalls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      capturedFetchCalls.push({ url, init });

      // Initiation request (POST with JSON content type)
      if (init.method === "POST") {
        return new Response(null, {
          status: 200,
          headers: { Location: FAKE_UPLOAD_URI },
        });
      }

      // Chunk upload (PUT) — return complete immediately
      return new Response(JSON.stringify({ id: "yt-video-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("uploadVideoToYouTube", () => {
  it("includes notifySubscribers=false in the initiation URL when set", async () => {
    const { uploadVideoToYouTube } = await import("./youtube-upload-service");

    const tmpFile = "/tmp/test-video.mp4";
    const fs = await import("fs");
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));

    try {
      await uploadVideoToYouTube({
        accessToken: "fake-token",
        filePath: tmpFile,
        title: "Test Short",
        description: "A test short",
        privacyStatus: "public",
        notifySubscribers: false,
        onProgress: () => {},
      }).pipe(Effect.provide(SidecarContextTest), Effect.runPromise);

      const initiationCall = capturedFetchCalls[0]!;
      const url = new URL(initiationCall.url);
      expect(url.searchParams.get("notifySubscribers")).toBe("false");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("uploadVideoToYouTube, interrupted", () => {
  // A post cut off by the sidecar must stop sending: a request left running
  // can land after the Job says "interrupted", and after its check said
  // "it did not go out".
  it("aborts the chunk still on the wire", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        calls.push(init);
        if (init.method === "POST") {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { Location: FAKE_UPLOAD_URI },
            })
          );
        }
        return new Promise(() => {}); // the chunk never gets an answer
      })
    );
    const { uploadVideoToYouTube } = await import("./youtube-upload-service");
    const fs = await import("fs");
    const tmpFile = "/tmp/test-video-interrupted.mp4";
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));
    try {
      const fiber = Effect.runFork(
        uploadVideoToYouTube({
          accessToken: "fake-token",
          filePath: tmpFile,
          title: "Test",
          description: "Test",
          privacyStatus: "public",
          notifySubscribers: false,
          onProgress: () => {},
        }).pipe(Effect.provide(SidecarContextTest))
      );
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(calls[1]?.signal?.aborted).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
