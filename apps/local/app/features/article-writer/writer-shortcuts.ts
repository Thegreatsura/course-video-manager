/**
 * The Article Writer's own keys, taken only when focus is NOT in something
 * that types:
 *
 * - F runs Fix, exactly when the Fix button is showing.
 * - Ctrl+Enter (Cmd+Enter on a Mac, like every Ctrl+Enter in the app) does
 *   nothing while the model is streaming; with no Body yet it presses Go (the
 *   chat's empty submit); otherwise it runs Apply, exactly when Apply is
 *   enabled.
 *
 * The decision is a pure function; `useWriterShortcuts` is the DOM wiring.
 * Like the preview's L / K, this surface lives inside the writer's dialog, so
 * it uses the guard's `isTypingTarget` half and scopes itself to keys from
 * that dialog (see docs/KEYBOARD_SHORTCUTS.md).
 */
import { useEffect, useRef, type RefObject } from "react";
import { isTypingTarget } from "@/hooks/should-ignore-keyboard-shortcut";

export type WriterShortcut = "fix" | "apply" | "go";

export interface WriterShortcutState {
  /** The model is streaming (or about to): `status` is streaming/submitted. */
  isGenerating: boolean;
  /** The Fix button is showing. */
  canFix: boolean;
  /** The Apply button is enabled. */
  canApply: boolean;
  /** No Body yet: the preview says "No document yet". */
  bodyIsEmpty: boolean;
}

type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "target"
>;

/** Selects and open menus or listboxes keep their own keys. */
const OWN_KEYS =
  'select, [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"]';

export function writerShortcutFor(
  e: ShortcutKeyEvent,
  state: WriterShortcutState
): WriterShortcut | null {
  if (!isFreeKey(e)) return null;
  if (isFixPress(e)) return state.canFix ? "fix" : null;
  if (!isApplyPress(e) || state.isGenerating) return null;
  if (state.bodyIsEmpty) return "go";
  return state.canApply ? "apply" : null;
}

/** Not held down, not Alt/Shift, and not aimed at something with its own keys. */
function isFreeKey(e: ShortcutKeyEvent): boolean {
  if (e.repeat || e.altKey || e.shiftKey) return false;
  if (isTypingTarget(e.target)) return false;
  return !(e.target as Element | null)?.closest?.(OWN_KEYS);
}

function isFixPress(e: ShortcutKeyEvent): boolean {
  return (e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey;
}

function isApplyPress(e: ShortcutKeyEvent): boolean {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey);
}

export const FIX_SHORTCUT_HINT = "F";
export const APPLY_SHORTCUT_HINT = "Ctrl+Enter";

/**
 * Listens for the writer's keys while `enabled`. `rootRef` is any element
 * inside the writer; keys count only from the dialog that holds it, and not
 * while a confirmation (`role="alertdialog"`) is open over it.
 */
export function useWriterShortcuts(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  state: WriterShortcutState,
  actions: Record<WriterShortcut, () => void>
) {
  const latest = useRef({ state, actions });
  latest.current = { state, actions };

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const shortcut = writerShortcutFor(e, latest.current.state);
      if (shortcut === null) return;

      const scope = root.closest('[role="dialog"]') ?? document.body;
      if (!(e.target instanceof Node) || !scope.contains(e.target)) return;
      const target = e.target as Element;
      if ((target.closest?.('[role="dialog"]') ?? scope) !== scope) return;
      if (scope.querySelector('[role="alertdialog"]')) return;

      e.preventDefault();
      latest.current.actions[shortcut]();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rootRef, enabled]);
}
