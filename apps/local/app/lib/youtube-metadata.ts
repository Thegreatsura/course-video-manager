/**
 * What YouTube refuses in a Video's or a Short's metadata, checked before
 * anything is queued and again before anything is sent. YouTube answers a
 * bad title with a bare `400 invalidTitle`, after the export has run; this
 * names the offending character or limit instead. It never rewrites the
 * metadata: the author fixes it.
 *
 * Callers pass the title and description as they will be sent (trimmed).
 */

export const YOUTUBE_TITLE_MAX_CHARACTERS = 100;
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;

const FORBIDDEN = /[<>]/;

export interface YouTubeMetadataProblem {
  readonly field: "title" | "description";
  readonly message: string;
}

/** The first thing YouTube would refuse, or `null` when it would accept both. */
export const findYouTubeMetadataProblem = (metadata: {
  readonly title: string;
  readonly description: string;
}): YouTubeMetadataProblem | null => {
  const title = metadata.title.trim();
  if (title.length === 0) {
    return { field: "title", message: "YouTube title can't be empty" };
  }
  if (/[\r\n]/.test(title)) {
    return {
      field: "title",
      message: "YouTube title must be a single line",
    };
  }
  const titleChar = title.match(FORBIDDEN)?.[0];
  if (titleChar) {
    return {
      field: "title",
      message: `YouTube title can't contain "${titleChar}" (YouTube refuses < and >)`,
    };
  }
  const titleLength = Array.from(title).length;
  if (titleLength > YOUTUBE_TITLE_MAX_CHARACTERS) {
    return {
      field: "title",
      message: `YouTube title is ${titleLength} characters; YouTube allows at most ${YOUTUBE_TITLE_MAX_CHARACTERS}`,
    };
  }

  const description = metadata.description.trim();
  const descriptionChar = description.match(FORBIDDEN)?.[0];
  if (descriptionChar) {
    return {
      field: "description",
      message: `YouTube description can't contain "${descriptionChar}" (YouTube refuses < and >)`,
    };
  }
  const descriptionBytes = new TextEncoder().encode(description).length;
  if (descriptionBytes > YOUTUBE_DESCRIPTION_MAX_BYTES) {
    return {
      field: "description",
      message: `YouTube description is ${descriptionBytes} bytes; YouTube allows at most ${YOUTUBE_DESCRIPTION_MAX_BYTES}`,
    };
  }
  return null;
};
