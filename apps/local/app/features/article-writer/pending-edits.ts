/**
 * The user's edits to the document while the model is still writing it,
 * held back from the real text until the stream ends.
 *
 * Every edit the document allows mid-stream (a Choose Screenshot's Clip,
 * face, crop, capture or removal, a Revive, a deleted block) is a rewrite of
 * one span of the text. So a pending edit is one span replacement, anchored
 * to the text that had arrived when it was made: its offset, plus the exact
 * text it replaces. The stream only appends, so the anchor stays put while
 * more text arrives after it. If the text under an anchor ever changes (the
 * model's `editDocument` rewrote it), the edit is dropped rather than applied
 * somewhere else.
 *
 * Kept sorted by `start` and never overlapping.
 */
export interface PendingEdit {
  /** Offsets into the real text. */
  readonly start: number;
  readonly end: number;
  /** `text.slice(start, end)` when the edit was made: the anchor. */
  readonly original: string;
  readonly replacement: string;
}

const anchored = (text: string, edit: PendingEdit) =>
  edit.end <= text.length && text.slice(edit.start, edit.end) === edit.original;

/**
 * The text as the user sees it: `text` with every pending edit applied.
 * An edit whose anchor no longer matches is left out and returned in
 * `dropped`, never applied to the wrong place.
 */
export function applyPendingEdits(
  text: string,
  edits: readonly PendingEdit[]
): { document: string; dropped: PendingEdit[] } {
  const dropped: PendingEdit[] = [];
  let document = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.start < at || !anchored(text, edit)) {
      dropped.push(edit);
      continue;
    }
    document += text.slice(at, edit.start) + edit.replacement;
    at = edit.end;
  }
  return { document: document + text.slice(at), dropped };
}

/** The edits still anchored in `text`, and the ones that are not. */
export function partitionAnchored(
  text: string,
  edits: readonly PendingEdit[]
): { kept: PendingEdit[]; dropped: PendingEdit[] } {
  const kept: PendingEdit[] = [];
  const dropped: PendingEdit[] = [];
  for (const edit of edits) (anchored(text, edit) ? kept : dropped).push(edit);
  return { kept, dropped };
}

/**
 * The one span that turns `before` into `after`: what is left once their
 * common prefix and suffix are trimmed. Null when they are the same.
 */
export function changedSpan(
  before: string,
  after: string
): { start: number; end: number; replacement: string } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let suffix = 0;
  while (
    suffix < max - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    start,
    end: before.length - suffix,
    replacement: after.slice(start, after.length - suffix),
  };
}

export type QueueEditResult =
  | { kind: "queued"; edits: PendingEdit[] }
  /** The edit was made on a document that has since changed under it. */
  | { kind: "stale" }
  /** The edit reaches into text that is still arriving. */
  | { kind: "still-arriving" };

/**
 * Queue the user's edit, which turned the shown document `before` into
 * `after`, as a pending edit on the real text.
 *
 * The changed span is found in shown-document offsets and mapped back to the
 * real text through the edits already queued. A span inside an earlier
 * edit's replacement rewrites that edit (a second change to the same
 * placeholder replaces the first). A span that covers earlier edits absorbs
 * them (deleting a block takes any edit inside it). The span may only reach
 * `editableEnd` in the real text: past that, the text is still arriving.
 */
export function queuePendingEdit(opts: {
  text: string;
  edits: readonly PendingEdit[];
  before: string;
  after: string;
  editableEnd: number;
}): QueueEditResult {
  const { text, edits, before, after, editableEnd } = opts;
  const span = changedSpan(before, after);
  if (!span) return { kind: "queued", edits: [...edits] };

  const shown = applyPendingEdits(text, edits).document;
  if (
    span.end > shown.length ||
    shown.slice(0, span.end) !== before.slice(0, span.end)
  ) {
    return { kind: "stale" };
  }

  // Where each queued edit sits in the shown document.
  let shift = 0;
  const placed = edits.map((edit) => {
    const shownStart = edit.start + shift;
    shift += edit.replacement.length - (edit.end - edit.start);
    return { edit, shownStart, shownEnd: shownStart + edit.replacement.length };
  });

  // The queued edits this one touches: any it starts or ends inside, and any
  // it covers (a deletion at either end of the span included).
  const touched = placed.filter(
    (p) =>
      (p.shownStart <= span.start && span.start < p.shownEnd) ||
      (p.shownStart < span.end && span.end <= p.shownEnd) ||
      (p.shownStart >= span.start && p.shownEnd <= span.end)
  );
  const shownLo = Math.min(span.start, ...touched.map((p) => p.shownStart));
  const shownHi = Math.max(span.end, ...touched.map((p) => p.shownEnd));

  // A shown offset outside every replacement, as an offset in the real text.
  const toText = (offset: number) => {
    let delta = 0;
    for (const p of placed) {
      if (p.shownEnd <= offset) delta = p.edit.end - p.shownEnd;
    }
    return offset + delta;
  };
  const startsAtLo = touched.filter((p) => p.shownStart === shownLo);
  const endsAtHi = touched.filter((p) => p.shownEnd === shownHi);
  const start = startsAtLo.length
    ? Math.min(...startsAtLo.map((p) => p.edit.start))
    : toText(shownLo);
  const end = endsAtHi.length
    ? Math.max(...endsAtHi.map((p) => p.edit.end))
    : toText(shownHi);

  if (end > editableEnd) return { kind: "still-arriving" };

  const merged: PendingEdit = {
    start,
    end,
    original: text.slice(start, end),
    replacement:
      shown.slice(shownLo, span.start) +
      span.replacement +
      shown.slice(span.end, shownHi),
  };
  const absorbed = new Set(touched.map((p) => p.edit));
  return {
    kind: "queued",
    edits: [...edits.filter((edit) => !absorbed.has(edit)), merged].sort(
      (a, b) => a.start - b.start || a.end - b.end
    ),
  };
}
