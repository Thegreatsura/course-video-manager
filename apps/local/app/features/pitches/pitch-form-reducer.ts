import type { EffectReducer } from "use-effect-reducer";

/**
 * The Pitch page's text fields and their autosave: an edit waits for typing
 * to pause, then saves that field; the indicator reads Saving… until every
 * save has landed, then Saved for a moment. See docs/FRONTEND_STATE.md.
 */
export namespace pitchFormReducer {
  export type Field =
    | "title"
    | "description"
    | "youtubeTitle"
    | "youtubeThumbnailDescription"
    | "newsletterTitle"
    | "tweet";

  export type Fields = Record<Field, string>;

  export interface Save {
    pitchId: string;
    field: Field;
    value: string;
  }

  export interface State {
    fields: Fields;
    saveState: "idle" | "pending" | "saved";
    /** Counts edits; only the latest edit's pause saves. */
    editId: number;
    /** The edit waiting for typing to pause before it saves. */
    waiting: Save | null;
    /** Saves sent and not yet answered. */
    inFlight: number;
  }

  export type Action =
    | { type: "field-edited"; pitchId: string; field: Field; value: string }
    | { type: "edit-pause-elapsed"; editId: number }
    | { type: "pitch-field-saved" }
    | { type: "pitch-field-save-failed" }
    | { type: "saved-shown-elapsed"; editId: number };

  export type Effect =
    | { type: "wait-for-edit-pause"; editId: number }
    | ({ type: "save-pitch-field" } & Save)
    | { type: "reload-pitch" }
    | { type: "wait-before-hiding-saved"; editId: number }
    | { type: "show-error"; message: string };
}

type State = pitchFormReducer.State;
type Exec = (effect: pitchFormReducer.Effect) => unknown;

export const createInitialPitchFormState = (
  fields: pitchFormReducer.Fields
): State => ({
  fields,
  saveState: "idle",
  editId: 0,
  waiting: null,
  inFlight: 0,
});

/** The edit a page that is being left still has to save. */
export const selectWaitingSave = (state: State) => state.waiting;

const send = (state: State, save: pitchFormReducer.Save, exec: Exec): State => {
  exec({ type: "save-pitch-field", ...save });
  return { ...state, inFlight: state.inFlight + 1 };
};

/** A save was answered: once nothing is left to save, say how it went. */
const settle = (state: State, ok: boolean, exec: Exec): State => {
  const next = { ...state, inFlight: Math.max(0, state.inFlight - 1) };
  if (!ok) {
    exec({ type: "show-error", message: "Couldn't save the Pitch" });
  }
  if (next.inFlight > 0 || next.waiting) return next;
  if (!ok) return { ...next, saveState: "idle" };
  exec({ type: "reload-pitch" });
  exec({ type: "wait-before-hiding-saved", editId: next.editId });
  return { ...next, saveState: "saved" };
};

export const pitchFormReducer: EffectReducer<
  State,
  pitchFormReducer.Action,
  pitchFormReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "field-edited": {
      // Another field's edit is still waiting: save it now, not never.
      const flushed =
        state.waiting && state.waiting.field !== action.field
          ? send({ ...state, waiting: null }, state.waiting, exec)
          : state;
      const editId = state.editId + 1;
      exec({ type: "wait-for-edit-pause", editId });
      return {
        ...flushed,
        fields: { ...state.fields, [action.field]: action.value },
        saveState: "pending",
        editId,
        waiting: {
          pitchId: action.pitchId,
          field: action.field,
          value: action.value,
        },
      };
    }
    case "edit-pause-elapsed":
      if (action.editId !== state.editId || !state.waiting) return state;
      return send({ ...state, waiting: null }, state.waiting, exec);
    case "pitch-field-saved":
      return settle(state, true, exec);
    case "pitch-field-save-failed":
      return settle(state, false, exec);
    case "saved-shown-elapsed":
      if (action.editId !== state.editId || state.saveState !== "saved") {
        return state;
      }
      return { ...state, saveState: "idle" };
  }
};
