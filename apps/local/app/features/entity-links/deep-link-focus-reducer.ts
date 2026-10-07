import type { EffectReducer } from "use-effect-reducer";
import type { DeepLinkTarget, DeepLinkTargetType } from "./entity-deep-link";

/**
 * Opening a copied link focuses the item it names: the page selects it, where
 * the page has a selection, and scrolls it into view.
 *
 * A link names an item by its DATABASE id, but a page may know its items by
 * another key — the Video editor selects by frontend id. So a page reports the
 * items it has loaded as candidates, each pairing the database id with the key
 * the page uses, and this reducer maps one to the other.
 *
 * It focuses the target ONCE. Items keep arriving after that (a poll, an
 * optimistic Clip saved, a revalidation) and must not steal the author's
 * selection back. A target that is not there yet is not given up on: if it
 * turns up in a later load it is focused then.
 */
export namespace deepLinkFocusReducer {
  /**
   * `waiting` — nothing loaded yet; `focused` — done; `missing` — not among
   * the items the page has; `archived` — there, but archived.
   */
  export type Status = "waiting" | "focused" | "missing" | "archived";

  export interface State {
    target: DeepLinkTarget | null;
    status: Status;
  }

  /** One item the page shows, under the key the page knows it by. */
  export interface Candidate {
    type: DeepLinkTargetType;
    /** The database id — the one a link carries. */
    id: string;
    /** The page's own key for the item: what it selects by. */
    key: string;
    /**
     * The `deepLinkAnchor` on the element to scroll to, when it is not `key`.
     * It must be the same in the server's HTML as on the client, so it is never
     * a frontend id, which each render mints afresh.
     */
    anchor?: string;
    archived?: boolean;
  }

  export type Action = {
    /**
     * The page has (re)loaded its items while its URL names `target`. A new
     * target — the URL changed — starts over.
     */
    type: "deep-link-candidates-loaded";
    target: DeepLinkTarget | null;
    candidates: ReadonlyArray<Candidate>;
  };

  export type Effect =
    | { type: "focus-deep-link-target"; candidate: Candidate }
    | {
        type: "show-deep-link-notice";
        reason: "missing" | "archived";
        target: DeepLinkTarget;
      };
}

export const createInitialDeepLinkFocusState =
  (): deepLinkFocusReducer.State => ({ target: null, status: "waiting" });

const sameTarget = (a: DeepLinkTarget | null, b: DeepLinkTarget | null) =>
  a?.type === b?.type && a?.id === b?.id;

export const deepLinkFocusReducer: EffectReducer<
  deepLinkFocusReducer.State,
  deepLinkFocusReducer.Action,
  deepLinkFocusReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "deep-link-candidates-loaded": {
      const current: deepLinkFocusReducer.State = sameTarget(
        state.target,
        action.target
      )
        ? state
        : { target: action.target, status: "waiting" };
      const { target } = current;
      if (!target || current.status === "focused") return current;

      const match = action.candidates.find(
        (c) => c.type === target.type && c.id === target.id
      );
      if (match && !match.archived) {
        exec({ type: "focus-deep-link-target", candidate: match });
        return { ...current, status: "focused" };
      }
      const status = match ? "archived" : "missing";
      if (status === current.status) return current;
      exec({ type: "show-deep-link-notice", reason: status, target });
      return { ...current, status };
    }
  }
};
