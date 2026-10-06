/**
 * True when the key is being typed into something — an input, a textarea, a
 * contenteditable, or a code editor (Monaco or CodeMirror). A shortcut must
 * never act on, or `preventDefault`, a key pressed there.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }

  const el = target as (Element & { isContentEditable?: boolean }) | null;

  // Monaco 0.55 types into an EditContext-backed contenteditable div rather than
  // a hidden textarea, so an inline script edit reaches us as a plain element.
  return Boolean(
    el?.isContentEditable ||
    el?.closest?.(".monaco-editor") ||
    el?.closest?.(".cm-editor")
  );
}

export function shouldIgnoreKeyboardShortcut(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return true;

  if (
    e.target instanceof HTMLButtonElement &&
    !e.target.classList.contains("allow-keydown")
  ) {
    return true;
  }

  const target = e.target as Element | null;
  if (target?.closest?.('[role="dialog"]')) {
    return true;
  }

  return false;
}
