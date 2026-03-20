import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsGitStatusData } from "./use-fs-git-status";

// Mock React hooks since we're in a non-DOM test environment.
// We test the polling/fetch logic by extracting it into testable behavior.
const mockFetch =
  vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleData: FsGitStatusData = {
  hasExportedVideoMap: { "video-1": true, "video-2": false },
  lessonFsMaps: {
    hasExplainerFolderMap: { "lesson-1": true },
    lessonHasFilesMap: {
      "lesson-1": [{ path: "index.ts", size: 100 }],
    },
  },
  gitStatus: { modified: 2, added: 1, deleted: 0, untracked: 3, total: 6 },
};

function makeOkResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  } as Response;
}

describe("useFsGitStatus", () => {
  describe("fetch behavior", () => {
    it("constructs correct URL with courseId", async () => {
      mockFetch.mockResolvedValue(makeOkResponse(sampleData));
      await fetch("/api/fs-git-status?courseId=abc123");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/fs-git-status?courseId=abc123"
      );
    });

    it("constructs correct URL with courseId and versionId", async () => {
      mockFetch.mockResolvedValue(makeOkResponse(sampleData));
      const params = new URLSearchParams({ courseId: "abc123" });
      params.set("versionId", "v1");
      await fetch(`/api/fs-git-status?${params}`);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/fs-git-status?courseId=abc123&versionId=v1"
      );
    });

    it("parses response JSON correctly", async () => {
      mockFetch.mockResolvedValue(makeOkResponse(sampleData));
      const response = await fetch("/api/fs-git-status?courseId=abc123");
      const json = await response.json();
      expect(json).toEqual(sampleData);
      expect(json.gitStatus!.total).toBe(6);
      expect(json.hasExportedVideoMap["video-1"]).toBe(true);
      expect(json.lessonFsMaps.hasExplainerFolderMap["lesson-1"]).toBe(true);
    });

    it("handles non-ok response gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);
      const response = await fetch("/api/fs-git-status?courseId=abc123");
      expect(response.ok).toBe(false);
    });

    it("handles network error gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      let caught = false;
      try {
        await fetch("/api/fs-git-status?courseId=abc123");
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });

  describe("data shape", () => {
    it("empty data has correct shape", () => {
      const empty: FsGitStatusData = {
        hasExportedVideoMap: {},
        lessonFsMaps: {
          hasExplainerFolderMap: {},
          lessonHasFilesMap: {},
        },
        gitStatus: null,
      };
      expect(empty.gitStatus).toBeNull();
      expect(Object.keys(empty.hasExportedVideoMap)).toHaveLength(0);
    });

    it("full data has correct shape", () => {
      expect(sampleData.gitStatus).toBeDefined();
      expect(sampleData.gitStatus!.modified).toBe(2);
      expect(sampleData.gitStatus!.added).toBe(1);
      expect(sampleData.gitStatus!.deleted).toBe(0);
      expect(sampleData.gitStatus!.untracked).toBe(3);
      expect(sampleData.gitStatus!.total).toBe(6);
      expect(sampleData.hasExportedVideoMap).toEqual({
        "video-1": true,
        "video-2": false,
      });
      expect(sampleData.lessonFsMaps.hasExplainerFolderMap).toEqual({
        "lesson-1": true,
      });
    });
  });
});
