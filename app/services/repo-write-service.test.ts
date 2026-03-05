import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { RepoWriteService } from "./repo-write-service";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

let tempDir: string;

const setupTempGitRepo = () => {
  tempDir = fs.mkdtempSync(path.join(tmpdir(), "repo-write-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });

  // Create initial commit so git is in a working state
  fs.writeFileSync(path.join(tempDir, ".gitkeep"), "");
  execSync("git add . && git commit -m 'init'", { cwd: tempDir });
};

const runEffect = <A, E>(effect: Effect.Effect<A, E, RepoWriteService>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(RepoWriteService.Default),
      Effect.provide(NodeContext.layer)
    )
  );

describe("RepoWriteService", () => {
  beforeEach(() => {
    setupTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createLessonDirectory", () => {
    it("creates explainer/readme.md with title from slug", async () => {
      // Create section directory
      fs.mkdirSync(path.join(tempDir, "01-intro"));

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          yield* service.createLessonDirectory({
            repoPath: tempDir,
            sectionPath: "01-intro",
            lessonDirName: "01.03-my-first-lesson",
          });
        })
      );

      const readmePath = path.join(
        tempDir,
        "01-intro",
        "01.03-my-first-lesson",
        "explainer",
        "readme.md"
      );
      expect(fs.existsSync(readmePath)).toBe(true);
      expect(fs.readFileSync(readmePath, "utf-8")).toBe("# My First Lesson\n");
    });

    it("creates the full directory structure recursively", async () => {
      // Section directory does NOT exist yet
      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          yield* service.createLessonDirectory({
            repoPath: tempDir,
            sectionPath: "02-advanced",
            lessonDirName: "02.01-getting-started",
          });
        })
      );

      const lessonDir = path.join(
        tempDir,
        "02-advanced",
        "02.01-getting-started"
      );
      const explainerDir = path.join(lessonDir, "explainer");

      expect(fs.existsSync(explainerDir)).toBe(true);
      expect(fs.existsSync(path.join(explainerDir, "readme.md"))).toBe(true);
    });

    it("derives title correctly from multi-word slug", async () => {
      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          yield* service.createLessonDirectory({
            repoPath: tempDir,
            sectionPath: "01-intro",
            lessonDirName: "01.01-understanding-type-inference",
          });
        })
      );

      const content = fs.readFileSync(
        path.join(
          tempDir,
          "01-intro",
          "01.01-understanding-type-inference",
          "explainer",
          "readme.md"
        ),
        "utf-8"
      );
      expect(content).toBe("# Understanding Type Inference\n");
    });
  });

  describe("addLesson", () => {
    it("creates lesson numbered as last in section", async () => {
      // Create section with two existing lessons
      const sectionDir = path.join(tempDir, "01-intro");
      fs.mkdirSync(path.join(sectionDir, "01.01-first-lesson", "explainer"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(sectionDir, "01.02-second-lesson", "explainer"), {
        recursive: true,
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          return yield* service.addLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            sectionNumber: 1,
            slug: "third-lesson",
          });
        })
      );

      expect(result.lessonNumber).toBe(3);
      expect(result.lessonDirName).toBe("01.03-third-lesson");

      const readmePath = path.join(
        sectionDir,
        "01.03-third-lesson",
        "explainer",
        "readme.md"
      );
      expect(fs.existsSync(readmePath)).toBe(true);
      expect(fs.readFileSync(readmePath, "utf-8")).toBe("# Third Lesson\n");
    });

    it("creates lesson number 1 in empty section", async () => {
      fs.mkdirSync(path.join(tempDir, "01-intro"));

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          return yield* service.addLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            sectionNumber: 1,
            slug: "first-lesson",
          });
        })
      );

      expect(result.lessonNumber).toBe(1);
      expect(result.lessonDirName).toBe("01.01-first-lesson");
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-intro",
            "01.01-first-lesson",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);
    });

    it("handles section with legacy 3-digit lesson format", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      fs.mkdirSync(path.join(sectionDir, "003-existing-lesson", "explainer"), {
        recursive: true,
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          return yield* service.addLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            sectionNumber: 1,
            slug: "new-lesson",
          });
        })
      );

      // Legacy format has lessonNumber=3, so next should be 4
      expect(result.lessonNumber).toBe(4);
      expect(result.lessonDirName).toBe("01.04-new-lesson");
    });

    it("ignores non-lesson directories in section", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      fs.mkdirSync(path.join(sectionDir, "01.01-first-lesson", "explainer"), {
        recursive: true,
      });
      // Non-lesson directories that should be ignored
      fs.mkdirSync(path.join(sectionDir, "node_modules"), { recursive: true });
      fs.mkdirSync(path.join(sectionDir, ".git"), { recursive: true });

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          return yield* service.addLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            sectionNumber: 1,
            slug: "second-lesson",
          });
        })
      );

      expect(result.lessonNumber).toBe(2);
      expect(result.lessonDirName).toBe("01.02-second-lesson");
    });

    it("handles non-existent section directory gracefully", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;

          return yield* service.addLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            sectionNumber: 1,
            slug: "first-lesson",
          });
        })
      );

      // Should create as lesson 1 since no existing lessons found
      expect(result.lessonNumber).toBe(1);
      expect(result.lessonDirName).toBe("01.01-first-lesson");
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-intro",
            "01.01-first-lesson",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);
    });
  });

  describe("renameLessons (batch)", () => {
    const createAndCommitLessons = (
      sectionDir: string,
      lessonNames: string[]
    ) => {
      for (const name of lessonNames) {
        const lessonDir = path.join(sectionDir, name, "explainer");
        fs.mkdirSync(lessonDir, { recursive: true });
        fs.writeFileSync(path.join(lessonDir, "readme.md"), `# ${name}\n`);
      }
      execSync("git add . && git commit -m 'add lessons'", { cwd: tempDir });
    };

    it("swaps two lessons without path collision", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, [
        "01.01-first",
        "01.02-second",
        "01.03-third",
      ]);

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [
              { oldPath: "01.01-first", newPath: "01.03-first" },
              { oldPath: "01.02-second", newPath: "01.01-second" },
              { oldPath: "01.03-third", newPath: "01.02-third" },
            ],
          });
        })
      );

      // Verify new structure
      expect(fs.existsSync(path.join(sectionDir, "01.01-second"))).toBe(true);
      expect(fs.existsSync(path.join(sectionDir, "01.02-third"))).toBe(true);
      expect(fs.existsSync(path.join(sectionDir, "01.03-first"))).toBe(true);
      // Old names should not exist
      expect(fs.existsSync(path.join(sectionDir, "01.01-first"))).toBe(false);
      expect(fs.existsSync(path.join(sectionDir, "01.02-second"))).toBe(false);
      expect(fs.existsSync(path.join(sectionDir, "01.03-third"))).toBe(false);
    });

    it("handles empty renames array (no-op)", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, ["01.01-only"]);

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [],
          });
        })
      );

      expect(fs.existsSync(path.join(sectionDir, "01.01-only"))).toBe(true);
    });

    it("renames are staged in git", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, ["01.01-aaa", "01.02-bbb"]);

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [
              { oldPath: "01.01-aaa", newPath: "01.02-aaa" },
              { oldPath: "01.02-bbb", newPath: "01.01-bbb" },
            ],
          });
        })
      );

      const status = execSync("git status --porcelain", { cwd: tempDir })
        .toString()
        .trim();
      expect(status).toContain("01.01-bbb");
      expect(status).toContain("01.02-aaa");
    });

    it("preserves unstaged changes through batch rename", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, ["01.01-alpha", "01.02-beta"]);

      // Add unstaged modification to first lesson
      fs.writeFileSync(
        path.join(sectionDir, "01.01-alpha", "explainer", "readme.md"),
        "# Modified alpha\n"
      );

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [
              { oldPath: "01.01-alpha", newPath: "01.02-alpha" },
              { oldPath: "01.02-beta", newPath: "01.01-beta" },
            ],
          });
        })
      );

      const content = fs.readFileSync(
        path.join(sectionDir, "01.02-alpha", "explainer", "readme.md"),
        "utf-8"
      );
      expect(content).toBe("# Modified alpha\n");
    });

    it("preserves untracked files through batch rename", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, ["01.01-one", "01.02-two"]);

      // Add untracked file
      fs.writeFileSync(
        path.join(sectionDir, "01.02-two", "notes.txt"),
        "my notes"
      );

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [
              { oldPath: "01.02-two", newPath: "01.01-two" },
              { oldPath: "01.01-one", newPath: "01.02-one" },
            ],
          });
        })
      );

      const content = fs.readFileSync(
        path.join(sectionDir, "01.01-two", "notes.txt"),
        "utf-8"
      );
      expect(content).toBe("my notes");
    });

    it("no temporary directories remain after rename", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLessons(sectionDir, ["01.01-x", "01.02-y"]);

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLessons({
            repoPath: tempDir,
            sectionPath: "01-intro",
            renames: [
              { oldPath: "01.01-x", newPath: "01.02-x" },
              { oldPath: "01.02-y", newPath: "01.01-y" },
            ],
          });
        })
      );

      const entries = fs.readdirSync(sectionDir);
      const tempEntries = entries.filter((e) => e.startsWith("__reorder_tmp_"));
      expect(tempEntries).toHaveLength(0);
    });
  });

  describe("renameLesson", () => {
    const createAndCommitLesson = (
      sectionDir: string,
      lessonDirName: string
    ) => {
      const lessonDir = path.join(sectionDir, lessonDirName, "explainer");
      fs.mkdirSync(lessonDir, { recursive: true });
      fs.writeFileSync(path.join(lessonDir, "readme.md"), "# Test\n");
      execSync("git add . && git commit -m 'add lesson'", { cwd: tempDir });
    };

    it("renames lesson directory via git mv, preserving lesson number", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLesson(sectionDir, "01.03-old-name");

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          return yield* service.renameLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            oldLessonDirName: "01.03-old-name",
            newSlug: "new-name",
          });
        })
      );

      expect(result.newLessonDirName).toBe("01.03-new-name");
      expect(
        fs.existsSync(
          path.join(sectionDir, "01.03-new-name", "explainer", "readme.md")
        )
      ).toBe(true);
      expect(fs.existsSync(path.join(sectionDir, "01.03-old-name"))).toBe(
        false
      );
    });

    it("rename is staged in git", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLesson(sectionDir, "01.01-original");

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            oldLessonDirName: "01.01-original",
            newSlug: "renamed",
          });
        })
      );

      const status = execSync("git status --porcelain", { cwd: tempDir })
        .toString()
        .trim();
      // git mv produces rename entries in the staging area
      expect(status).toContain("01.01-renamed");
    });

    it("returns same name when slug is unchanged (no-op)", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLesson(sectionDir, "01.02-keep-this");

      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          return yield* service.renameLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            oldLessonDirName: "01.02-keep-this",
            newSlug: "keep-this",
          });
        })
      );

      expect(result.newLessonDirName).toBe("01.02-keep-this");
      // Directory should still exist unchanged
      expect(
        fs.existsSync(
          path.join(sectionDir, "01.02-keep-this", "explainer", "readme.md")
        )
      ).toBe(true);
    });

    it("preserves unstaged changes through rename", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLesson(sectionDir, "01.01-has-changes");

      // Add unstaged modification
      fs.writeFileSync(
        path.join(sectionDir, "01.01-has-changes", "explainer", "readme.md"),
        "# Modified content\n"
      );

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            oldLessonDirName: "01.01-has-changes",
            newSlug: "renamed-changes",
          });
        })
      );

      // File should exist at new location with modified content preserved
      const content = fs.readFileSync(
        path.join(
          sectionDir,
          "01.01-renamed-changes",
          "explainer",
          "readme.md"
        ),
        "utf-8"
      );
      expect(content).toBe("# Modified content\n");
    });

    it("preserves untracked files through rename", async () => {
      const sectionDir = path.join(tempDir, "01-intro");
      createAndCommitLesson(sectionDir, "01.01-has-untracked");

      // Add an untracked file
      fs.writeFileSync(
        path.join(sectionDir, "01.01-has-untracked", "notes.txt"),
        "my notes"
      );

      await runEffect(
        Effect.gen(function* () {
          const service = yield* RepoWriteService;
          yield* service.renameLesson({
            repoPath: tempDir,
            sectionPath: "01-intro",
            oldLessonDirName: "01.01-has-untracked",
            newSlug: "renamed-untracked",
          });
        })
      );

      // Untracked file should be carried along
      const content = fs.readFileSync(
        path.join(sectionDir, "01.01-renamed-untracked", "notes.txt"),
        "utf-8"
      );
      expect(content).toBe("my notes");
    });
  });
});
