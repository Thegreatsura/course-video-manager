import { createContext, useContext } from "react";

/**
 * The one way anything on the Diagram Playground reports how an operation
 * went. Toasts are off on this page (`handle = NO_TOASTS`), so `toast.*` is
 * banned here by lint; an error goes to the status line, held in
 * `diagramPlaygroundReducer`, and a success is silent: it only clears the
 * error.
 */
export interface PlaygroundStatus {
  /** Show `message` in the status line until a success or a timeout. */
  reportError: (message: string) => void;
  /** Something the author asked for worked. Shows nothing. */
  reportSuccess: () => void;
}

const PlaygroundStatusContext = createContext<PlaygroundStatus | null>(null);

/** Provided by the Active Diagram route, from `useDiagramPlaygroundReducer`. */
export const PlaygroundStatusProvider = PlaygroundStatusContext.Provider;

export function usePlaygroundStatus(): PlaygroundStatus {
  const status = useContext(PlaygroundStatusContext);
  if (!status) {
    throw new Error(
      "usePlaygroundStatus must be used inside the Diagram Playground's PlaygroundStatusProvider"
    );
  }
  return status;
}
