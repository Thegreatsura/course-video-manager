import { describe, expect, it } from "vitest";
import { uploadReducer } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const aiHeroConfig = uploadTypeRegistry["ai-hero"]!;
const skillsChangelogConfig = uploadTypeRegistry["skills-changelog"]!;

const makeBase = (
  overrides: Partial<uploadReducer.BaseUploadEntry> = {}
): uploadReducer.BaseUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Post",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  ...overrides,
});

describe("ai-hero registry entry", () => {
  it("should be registered in the registry", () => {
    expect(aiHeroConfig).toBeDefined();
  });

  it("should have supportsDependsOn set to true", () => {
    expect(aiHeroConfig.supportsDependsOn).toBe(true);
  });

  describe("createEntry", () => {
    it("should create an ai-hero entry with aiHeroSlug null", () => {
      const base = makeBase();

      const entry = aiHeroConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "AI Hero Post",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "ai-hero",
        aiHeroSlug: null,
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = aiHeroConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "AI Hero Post",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should reset aiHeroSlug to null", () => {
      const base = makeBase({ errorMessage: "some error", retryCount: 1 });
      const prevEntry: uploadReducer.AiHeroUploadEntry = {
        ...base,
        uploadType: "ai-hero",
        aiHeroSlug: "old-slug~123",
      };

      const entry = aiHeroConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "ai-hero",
        aiHeroSlug: null,
      });
    });

    it("should preserve null aiHeroSlug", () => {
      const base = makeBase({ retryCount: 2 });
      const prevEntry: uploadReducer.AiHeroUploadEntry = {
        ...base,
        uploadType: "ai-hero",
        aiHeroSlug: null,
      };

      const entry = aiHeroConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "ai-hero",
        aiHeroSlug: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and store aiHeroSlug", () => {
      const entry: uploadReducer.AiHeroUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "ai-hero",
        aiHeroSlug: null,
      };

      const result = aiHeroConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        aiHeroSlug: "my-post~abc123",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        aiHeroSlug: "my-post~abc123",
      });
    });

    it("should default aiHeroSlug to null when not provided", () => {
      const entry: uploadReducer.AiHeroUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "ai-hero",
        aiHeroSlug: null,
      };

      const result = aiHeroConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.aiHeroSlug).toBeNull();
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.AiHeroUploadEntry = {
        ...makeBase({
          progress: 50,
          errorMessage: "previous error",
          retryCount: 1,
        }),
        uploadType: "ai-hero",
        aiHeroSlug: null,
      };

      const result = aiHeroConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        aiHeroSlug: "my-post~abc",
      });

      expect(result.errorMessage).toBeNull();
    });
  });

  describe("initiate", () => {
    it("has no browser driver: a ai-hero post is a posting Job the Sidecar runs once", () => {
      expect(uploadTypeRegistry["ai-hero"].initiate).toBeNull();
    });
  });
});

describe("skills-changelog registry entry", () => {
  it("should be registered in the registry", () => {
    expect(skillsChangelogConfig).toBeDefined();
  });

  it("should have supportsDependsOn set to true", () => {
    expect(skillsChangelogConfig.supportsDependsOn).toBe(true);
  });

  describe("createEntry", () => {
    it("should create a skills-changelog entry with skillsChangelogSlug null", () => {
      const base = makeBase();

      const entry = skillsChangelogConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Skills Changelog Post",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = skillsChangelogConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Skills Changelog Post",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should reset skillsChangelogSlug to null", () => {
      const base = makeBase({ errorMessage: "some error", retryCount: 1 });
      const prevEntry: uploadReducer.SkillsChangelogUploadEntry = {
        ...base,
        uploadType: "skills-changelog",
        skillsChangelogSlug: "old-slug~123",
      };

      const entry = skillsChangelogConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      });
    });

    it("should preserve null skillsChangelogSlug", () => {
      const base = makeBase({ retryCount: 2 });
      const prevEntry: uploadReducer.SkillsChangelogUploadEntry = {
        ...base,
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      };

      const entry = skillsChangelogConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and store skillsChangelogSlug", () => {
      const entry: uploadReducer.SkillsChangelogUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      };

      const result = skillsChangelogConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        skillsChangelogSlug: "my-changelog~abc123",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        skillsChangelogSlug: "my-changelog~abc123",
      });
    });

    it("should default skillsChangelogSlug to null when not provided", () => {
      const entry: uploadReducer.SkillsChangelogUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      };

      const result = skillsChangelogConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.skillsChangelogSlug).toBeNull();
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.SkillsChangelogUploadEntry = {
        ...makeBase({
          progress: 50,
          errorMessage: "previous error",
          retryCount: 1,
        }),
        uploadType: "skills-changelog",
        skillsChangelogSlug: null,
      };

      const result = skillsChangelogConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        skillsChangelogSlug: "my-changelog~abc",
      });

      expect(result.errorMessage).toBeNull();
    });
  });

  describe("initiate", () => {
    it("has no browser driver: a skills-changelog post is a posting Job the Sidecar runs once", () => {
      expect(uploadTypeRegistry["skills-changelog"].initiate).toBeNull();
    });
  });
});
