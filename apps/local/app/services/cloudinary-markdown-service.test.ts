import { describe, it, expect } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import { Effect, Layer } from "effect";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CloudinaryService } from "./cloudinary-service";
import type { ImageUploaded } from "@/features/image-upload/image-upload-job";
import fs from "node:fs";
import path from "node:path";

// Mock fs.existsSync
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

let testLayer: Layer.Layer<CloudinaryMarkdownService>;
let uploads: string[];

const run = (
  body: string,
  options: {
    recorded?: ImageUploaded[];
    recordedEarlier?: Map<string, string>;
  } = {}
) =>
  Effect.gen(function* () {
    const service = yield* CloudinaryMarkdownService;
    const records: ImageUploaded[] = [];
    const result = yield* service.uploadLocalImages(body, "/base", {
      recorded: options.recorded ?? [],
      recordedEarlier: options.recordedEarlier ?? new Map(),
      record: (image) => Effect.sync(() => void records.push(image)),
    });
    return { ...result, records };
  }).pipe(Effect.provide(testLayer));

describe("CloudinaryMarkdownService.uploadLocalImages", () => {
  beforeEach(() => {
    uploads = [];
    const mockCloudinaryLayer = Layer.succeed(CloudinaryService, {
      upload: (filePath: string) =>
        Effect.sync(() => {
          uploads.push(filePath);
          return `https://res.cloudinary.com/test/${path.basename(filePath)}`;
        }),
    } as any);
    testLayer = CloudinaryMarkdownService.Default.pipe(
      Layer.provide(mockCloudinaryLayer)
    );
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it.effect("records nothing when the body has no local image", () =>
    Effect.gen(function* () {
      const result = yield* run(
        "# Hello\n\n![remote](https://cdn.example.com/a.png)"
      );
      expect(result.records).toEqual([]);
      expect(uploads).toEqual([]);
    })
  );

  it.effect("uploads each local image once and records it by reference", () =>
    Effect.gen(function* () {
      const result = yield* run(
        [
          "![one](a.png)",
          "![again](a.png)",
          "![other ref, same file](./a.png)",
          "![chart](images/chart.png)",
        ].join("\n")
      );
      expect(uploads).toEqual([
        path.resolve("/base", "a.png"),
        path.resolve("/base", "images/chart.png"),
      ]);
      expect(result.records.map((r) => r.ref)).toEqual([
        "a.png",
        "./a.png",
        "images/chart.png",
      ]);
      expect(result.records[1]!.url).toBe(result.records[0]!.url);
      expect(result.uploaded).toBe(2);
    })
  );

  it.effect("skips what an earlier run of the Job recorded", () =>
    Effect.gen(function* () {
      const result = yield* run("![a](a.png)\n![b](b.png)", {
        recorded: [
          {
            ref: "a.png",
            filePath: path.resolve("/base", "a.png"),
            url: "https://c/a",
          },
        ],
      });
      expect(uploads).toEqual([path.resolve("/base", "b.png")]);
      expect(result.records.map((r) => r.ref)).toEqual(["b.png"]);
    })
  );

  it.effect(
    "gives a removed file the URL an earlier Job recorded, without uploading",
    () =>
      Effect.gen(function* () {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const filePath = path.resolve("/base", "gone.png");
        const result = yield* run("![gone](gone.png)", {
          recordedEarlier: new Map([[filePath, "https://c/gone"]]),
        });
        expect(uploads).toEqual([]);
        expect(result.records).toEqual([
          { ref: "gone.png", filePath, url: "https://c/gone" },
        ]);
      })
  );

  it.effect(
    "fails when an image file does not exist and was never uploaded",
    () =>
      Effect.gen(function* () {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const result = yield* Effect.either(run("![missing](nonexistent.png)"));
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect((result.left as any).message).toContain(
            "Image file not found"
          );
        }
      })
  );
});
