import { describe, it, expect } from "vitest";
import { applyEdits } from "./document-editing-engine";
import type { DocumentEdit } from "./document-editing-engine";

describe("applyEdits", () => {
  describe("replace", () => {
    it("finds and replaces unique old_text with new_text", () => {
      const doc = "Hello world, this is a test.";
      const result = applyEdits(doc, [
        { type: "replace", old_text: "world", new_text: "universe" },
      ]);
      expect(result).toEqual({ document: "Hello universe, this is a test." });
    });

    it("deletes text when new_text is empty", () => {
      const doc = "Keep this. Remove this. Keep this too.";
      const result = applyEdits(doc, [
        { type: "replace", old_text: " Remove this.", new_text: "" },
      ]);
      expect(result).toEqual({ document: "Keep this. Keep this too." });
    });

    it("fails with descriptive error when old_text is not found", () => {
      const doc = "Hello world.";
      const result = applyEdits(doc, [
        { type: "replace", old_text: "nonexistent", new_text: "something" },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("not found in document"),
      });
      expect(result).toEqual({
        error: expect.stringContaining("nonexistent"),
      });
    });

    it("fails with descriptive error when old_text matches multiple locations", () => {
      const doc = "foo bar foo baz foo";
      const result = applyEdits(doc, [
        { type: "replace", old_text: "foo", new_text: "qux" },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("matched 3 locations"),
      });
    });

    it("uses whitespace-insensitive fallback when exact match fails", () => {
      const doc = "Hello   world,\n  this is   a test.";
      const result = applyEdits(doc, [
        {
          type: "replace",
          old_text: "Hello world, this is a test.",
          new_text: "Replaced.",
        },
      ]);
      expect(result).toEqual({ document: "Replaced." });
    });

    it("whitespace fallback fails when multiple matches exist", () => {
      const doc = "hello  world and hello  world";
      const result = applyEdits(doc, [
        {
          type: "replace",
          old_text: "hello world",
          new_text: "replaced",
        },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("matched 2 locations"),
      });
    });
  });

  describe("insert_after", () => {
    it("inserts new_text immediately after the anchor", () => {
      const doc = "# Introduction\n\nSome content here.";
      const result = applyEdits(doc, [
        {
          type: "insert_after",
          anchor: "# Introduction",
          new_text: "\n\nInserted paragraph.",
        },
      ]);
      expect(result).toEqual({
        document: "# Introduction\n\nInserted paragraph.\n\nSome content here.",
      });
    });

    it("fails when anchor is not found", () => {
      const doc = "Hello world.";
      const result = applyEdits(doc, [
        {
          type: "insert_after",
          anchor: "nonexistent",
          new_text: "something",
        },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("anchor not found"),
      });
    });

    it("fails when anchor matches multiple locations", () => {
      const doc = "foo bar foo baz";
      const result = applyEdits(doc, [
        { type: "insert_after", anchor: "foo", new_text: " INSERTED" },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("matched 2 locations"),
      });
    });

    it("uses whitespace-insensitive fallback for anchor", () => {
      const doc = "Hello   world, more text.";
      const result = applyEdits(doc, [
        {
          type: "insert_after",
          anchor: "Hello world,",
          new_text: " INSERTED",
        },
      ]);
      expect(result).toEqual({
        document: "Hello   world, INSERTED more text.",
      });
    });
  });

  describe("rewrite", () => {
    it("replaces entire document with new_text", () => {
      const doc = "Old content that will be completely replaced.";
      const result = applyEdits(doc, [
        { type: "rewrite", new_text: "Brand new document." },
      ]);
      expect(result).toEqual({ document: "Brand new document." });
    });

    it("can rewrite to empty document", () => {
      const result = applyEdits("Some content.", [
        { type: "rewrite", new_text: "" },
      ]);
      expect(result).toEqual({ document: "" });
    });
  });

  describe("sequential edits", () => {
    it("applies multiple edits sequentially — later edits see modified document", () => {
      const doc = "AAA BBB CCC";
      const edits: DocumentEdit[] = [
        { type: "replace", old_text: "BBB", new_text: "XXX" },
        { type: "replace", old_text: "XXX", new_text: "YYY" },
      ];
      const result = applyEdits(doc, edits);
      expect(result).toEqual({ document: "AAA YYY CCC" });
    });

    it("replace then insert_after", () => {
      const doc = "# Title\n\nOld intro.\n\nBody.";
      const edits: DocumentEdit[] = [
        {
          type: "replace",
          old_text: "Old intro.",
          new_text: "New intro.",
        },
        {
          type: "insert_after",
          anchor: "New intro.",
          new_text: "\n\nAdded section.",
        },
      ];
      const result = applyEdits(doc, edits);
      expect(result).toEqual({
        document: "# Title\n\nNew intro.\n\nAdded section.\n\nBody.",
      });
    });

    it("stops on first error and returns it", () => {
      const doc = "Hello world.";
      const edits: DocumentEdit[] = [
        { type: "replace", old_text: "Hello", new_text: "Hi" },
        { type: "replace", old_text: "nonexistent", new_text: "fail" },
        { type: "replace", old_text: "world", new_text: "earth" },
      ];
      const result = applyEdits(doc, edits);
      expect(result).toEqual({
        error: expect.stringContaining("Edit 1"),
      });
      expect(result).toEqual({
        error: expect.stringContaining("not found"),
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty edits array", () => {
      const doc = "Unchanged.";
      const result = applyEdits(doc, []);
      expect(result).toEqual({ document: "Unchanged." });
    });

    it("handles multiline old_text in replace", () => {
      const doc = `First line.
Second line.
Third line.`;

      const result = applyEdits(doc, [
        {
          type: "replace",
          old_text: "First line.\nSecond line.",
          new_text: "Replaced two lines.",
        },
      ]);

      expect(result).toEqual({
        document: "Replaced two lines.\nThird line.",
      });
    });

    it("truncates long old_text in error messages", () => {
      const longText = "x".repeat(200);
      const result = applyEdits("short doc", [
        { type: "replace", old_text: longText, new_text: "replacement" },
      ]);
      expect(result).toEqual({
        error: expect.stringContaining("..."),
      });
    });
  });
});
