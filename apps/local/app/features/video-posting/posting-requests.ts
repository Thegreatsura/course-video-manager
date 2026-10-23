import type { CourseStructure } from "@/components/video-context-panel";

/**
 * The calls the posting pages' effect runners make, shared so the post page
 * and the Shorts modal send the same requests. Glue only: what to do with the
 * answer is the reducers' decision.
 */

/** What the model is asked to write for a posting field, about one Video. */
export interface GenerateTextRequest {
  videoId: string;
  mode: "youtube-title-single" | "youtube-description";
  enabledFiles: string[];
  includeTranscript: boolean;
  enabledSections: string[];
  courseStructure?: CourseStructure;
}

export const generateText = async ({
  videoId,
  ...body
}: GenerateTextRequest): Promise<string> => {
  const response = await fetch(`/api/videos/${videoId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Failed to generate content");
  const result = await response.json();
  return result.text as string;
};

/** One aihero.dev URL and the short link that now stands for it. */
export interface CreatedShortLink {
  url: string;
  shortLinkUrl: string;
}

/** Finds or creates a short link for each URL, one after another. */
export const createShortLinks = async (
  urls: string[],
  linkDescription: string
): Promise<CreatedShortLink[]> => {
  const links: CreatedShortLink[] = [];
  for (const url of urls) {
    const response = await fetch("/api/shortlinks/find-or-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, description: linkDescription }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to create short link");
    }
    const { shortLinkUrl } = await response.json();
    links.push({ url, shortLinkUrl });
  }
  return links;
};
