/**
 * Whether the routes on screen want Sonner toasts at all.
 *
 * Some windows are not for reading notifications: the teleprompter is pointed
 * at a camera lens and the Diagram Playground is recorded on screen. A route
 * opts out by exporting `handle = NO_TOASTS` (or any handle with
 * `toasts: false`); root then does not render the `<Toaster />`, so a toast
 * fired there — a Job finishing, an error — is simply not shown.
 */
export type ToastsHandle = { toasts?: boolean };

export const NO_TOASTS = { toasts: false } as const satisfies ToastsHandle;

export const toastsAllowed = (
  matches: ReadonlyArray<{ handle?: unknown }>
): boolean =>
  !matches.some(
    (m) => (m.handle as ToastsHandle | undefined)?.toasts === false
  );
