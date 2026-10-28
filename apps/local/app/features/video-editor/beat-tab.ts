/**
 * The five occupants of the editor's tabbed side slot. The Beats tab shows
 * *this video's own* plan; the Reference tab shows the sibling-video reader;
 * the Script tab shows this video's teleprompter script; the Animatic tab
 * shows its Clip Mockups read as lines; the Suggestions tab streams the next
 * line to say onto the teleprompter. They merely share screen real estate —
 * "Reference" stays reserved for the sibling reader, never the beat, script or
 * Animatic view.
 */
export type BeatTab =
  "beats" | "reference" | "script" | "animatic" | "suggestions";

export const BEAT_TABS: readonly BeatTab[] = [
  "beats",
  "reference",
  "script",
  "animatic",
  "suggestions",
];

/**
 * Where the author's last tab choice is kept: ONE key for every Video, so
 * moving to the previous or next Video keeps the tab they were on (#2415).
 * Suggestions is remembered too; a Video opened on it waits for Refresh
 * before it asks the model (see `suggestions-reducer.ts`). A stored value this app no longer knows (a `mockups`
 * tab from before that tab went away) reads back as Script.
 */
export const BEAT_TAB_STORAGE_KEY = "video-editor:side-panel-tab";

/**
 * Resolve which tab the editor's side slot should show, given the persisted
 * choice and which tabs currently exist. Pure and total so it can be unit
 * tested independently of React:
 *
 *  - Honour the persisted tab if it still exists. The persisted tab is the
 *    last one the author picked on ANY Video, so a tab this Video lacks shows
 *    Script without forgetting the choice: the next Video that has it shows it.
 *  - Otherwise Script. It always exists (you author the script there, empty or
 *    not), it's what the teleprompter mirrors, and it's what you're in front of
 *    for most of a session. Reference and Beats are still selected outright by
 *    the actions that open them — adding a reference, or jumping to a beat —
 *    they're just not what an unopened video falls back to.
 */
export const resolveBeatTab = ({
  persistedTab,
  hasBeats,
  hasReference,
  hasAnimatic,
}: {
  persistedTab: BeatTab | null;
  hasBeats: boolean;
  hasReference: boolean;
  hasAnimatic: boolean;
}): BeatTab => {
  const exists = (tab: BeatTab): boolean => {
    if (tab === "beats") return hasBeats;
    if (tab === "animatic") return hasAnimatic;
    if (tab === "reference") return hasReference;
    // Suggestions, like Script, needs no loader flag: it works from whatever
    // sources the video has.
    // Script is always available: an empty Script is authored in place, so it
    // needs no loader flag to decide it exists.
    return true;
  };

  if (persistedTab !== null && exists(persistedTab)) return persistedTab;

  return "script";
};
