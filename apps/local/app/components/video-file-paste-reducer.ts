import type { EffectReducer } from "use-effect-reducer";

/**
 * The Paste from Clipboard dialog: what was pasted, the path it will be
 * created at (named for it, next to the Video's files), and the create
 * request. See docs/FRONTEND_STATE.md.
 */
export namespace videoFilePasteReducer {
  export interface PastedContent {
    type: "text" | "image";
    /** The text, or the image as a data URL. */
    data: string;
  }

  export interface State {
    pasted: PastedContent | null;
    path: string;
    /** A create request is in flight. */
    creating: boolean;
  }

  export type Action =
    | { type: "modal-opened" }
    | {
        type: "content-pasted";
        content: PastedContent;
        /** The Video's files as they are now, so the new path is free. */
        existingPaths: string[];
        defaultTextFilename?: string;
      }
    | { type: "paste-cleared" }
    | { type: "path-edited"; path: string }
    | { type: "create-clicked"; videoId: string }
    | { type: "file-created"; path: string }
    | { type: "file-create-failed" };

  export type Effect =
    | { type: "focus-paste-area" }
    | { type: "focus-path-input" }
    | { type: "create-file"; videoId: string; path: string; content: string }
    | { type: "close-modal" }
    | { type: "report-file-created"; path: string };
}

export const createInitialVideoFilePasteState =
  (): videoFilePasteReducer.State => ({
    pasted: null,
    path: "",
    creating: false,
  });

/**
 * The next free path for pasted content: `diagram-N.png` for an image, and
 * for text the default filename (`notes.md`), then `notes-1.md`, `notes-2.md`…
 */
export const generatePastePath = (
  type: videoFilePasteReducer.PastedContent["type"],
  existingPaths: string[],
  defaultTextFilename?: string
): string => {
  if (type === "image") {
    let counter = 1;
    while (existingPaths.includes(`diagram-${counter}.png`)) counter++;
    return `diagram-${counter}.png`;
  }
  const baseName = defaultTextFilename || "notes.md";
  const ext = baseName.endsWith(".md") ? ".md" : "";
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  if (!existingPaths.includes(baseName)) return baseName;
  let counter = 1;
  while (existingPaths.includes(`${stem}-${counter}${ext}`)) counter++;
  return `${stem}-${counter}${ext}`;
};

export const videoFilePasteReducer: EffectReducer<
  videoFilePasteReducer.State,
  videoFilePasteReducer.Action,
  videoFilePasteReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "modal-opened":
      exec({ type: "focus-paste-area" });
      return { ...state, pasted: null, path: "" };
    case "content-pasted":
      exec({ type: "focus-path-input" });
      return {
        ...state,
        pasted: action.content,
        path: generatePastePath(
          action.content.type,
          action.existingPaths,
          action.defaultTextFilename
        ),
      };
    case "paste-cleared":
      return { ...state, pasted: null };
    case "path-edited":
      return { ...state, path: action.path };
    case "create-clicked": {
      if (!state.pasted || !state.path || state.creating) return state;
      exec({
        type: "create-file",
        videoId: action.videoId,
        path: state.path,
        content: state.pasted.data,
      });
      return { ...state, creating: true };
    }
    case "file-created":
      if (!state.creating) return state;
      exec({ type: "close-modal" });
      exec({ type: "report-file-created", path: action.path });
      return { ...state, creating: false };
    case "file-create-failed":
      return { ...state, creating: false };
  }
};
