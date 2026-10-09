import { describe, expect, it } from "vitest";
import {
  IMAGE_UPLOADED_EVENT,
  imageUploadsOf,
  localImageRefs,
  swapImageUploads,
  type ImageUploaded,
} from "./image-upload-job";

const up = (ref: string, url: string, filePath = `/v/${ref}`) =>
  ({ ref, filePath, url }) satisfies ImageUploaded;

/** A body with every shape an image takes in a real article. */
const SAMPLE_BODY = [
  "# Generics",
  "",
  "Intro with ![the diagram](./diagram.png) inline.",
  "",
  "- A list item: ![chart in a list](images/chart.png)",
  "- Same diagram again: ![diagram, twice](./diagram.png)",
  "",
  "> A quote with ![](quote.png) and no alt text.",
  "",
  "```ts",
  "const x = 1; // code just before an image",
  "```",
  "![after the fence](after-code.png)",
  "",
  "Hosted already: ![remote](https://cdn.example.com/photo.jpg)",
  "Ordinary link, not an image: [diagram](./diagram.png)",
].join("\n");

const SAMPLE_UPLOADS = [
  up("./diagram.png", "https://res.cloudinary.com/x/diagram"),
  up("images/chart.png", "https://res.cloudinary.com/x/chart"),
  up("quote.png", "https://res.cloudinary.com/x/quote"),
  up("after-code.png", "https://res.cloudinary.com/x/after-code"),
];

describe("localImageRefs", () => {
  it("names each local image once, in order, and no hosted one", () => {
    expect(localImageRefs(SAMPLE_BODY)).toEqual([
      "./diagram.png",
      "images/chart.png",
      "quote.png",
      "after-code.png",
    ]);
  });
});

describe("swapImageUploads", () => {
  it("changes only each local image's (ref), nothing else in the body", () => {
    const { body, swappedFilePaths } = swapImageUploads(
      SAMPLE_BODY,
      SAMPLE_UPLOADS
    );
    expect(body).toBe(
      [
        "# Generics",
        "",
        "Intro with ![the diagram](https://res.cloudinary.com/x/diagram) inline.",
        "",
        "- A list item: ![chart in a list](https://res.cloudinary.com/x/chart)",
        "- Same diagram again: ![diagram, twice](https://res.cloudinary.com/x/diagram)",
        "",
        "> A quote with ![](https://res.cloudinary.com/x/quote) and no alt text.",
        "",
        "```ts",
        "const x = 1; // code just before an image",
        "```",
        "![after the fence](https://res.cloudinary.com/x/after-code)",
        "",
        "Hosted already: ![remote](https://cdn.example.com/photo.jpg)",
        "Ordinary link, not an image: [diagram](./diagram.png)",
      ].join("\n")
    );
    expect(swappedFilePaths.sort()).toEqual(
      SAMPLE_UPLOADS.map((u) => u.filePath).sort()
    );
  });

  it("swaps into the body as edited while the Job ran, keeping the edit", () => {
    const atPress = "![a](a.png)\n\n![b](b.png)";
    // The author typed while the upload ran.
    const edited =
      "Intro typed mid-upload.\n\n![a](a.png)\n\n![b](b.png)\nMore.";
    const uploads = [up("a.png", "https://c/a"), up("b.png", "https://c/b")];
    expect(localImageRefs(atPress)).toEqual(["a.png", "b.png"]);
    expect(swapImageUploads(edited, uploads).body).toBe(
      "Intro typed mid-upload.\n\n![a](https://c/a)\n\n![b](https://c/b)\nMore."
    );
  });

  it("never puts back a reference the author deleted, and does not report its file", () => {
    const uploads = [up("a.png", "https://c/a"), up("b.png", "https://c/b")];
    const edited = "![a](a.png) — b was deleted mid-upload";
    const result = swapImageUploads(edited, uploads);
    expect(result.body).toBe("![a](https://c/a) — b was deleted mid-upload");
    expect(result.body).not.toContain("https://c/b");
    // b's file was not swapped in, so it must not be removed.
    expect(result.swappedFilePaths).toEqual(["/v/a.png"]);
  });

  it("is a no-op the second time: no double swap, no duplicated link", () => {
    const once = swapImageUploads(SAMPLE_BODY, SAMPLE_UPLOADS).body;
    const twice = swapImageUploads(once, SAMPLE_UPLOADS);
    expect(twice.body).toBe(once);
    expect(twice.swappedFilePaths).toEqual([]);
    expect(once.match(/res\.cloudinary\.com\/x\/diagram/g)).toHaveLength(2);
  });
});

describe("imageUploadsOf", () => {
  it("reads only well-formed image-uploaded events", () => {
    expect(
      imageUploadsOf([
        { type: "progress", data: { percent: 50 } },
        { type: IMAGE_UPLOADED_EVENT, data: up("a.png", "https://c/a") },
        { type: IMAGE_UPLOADED_EVENT, data: { ref: "broken" } },
      ])
    ).toEqual([up("a.png", "https://c/a")]);
  });
});
