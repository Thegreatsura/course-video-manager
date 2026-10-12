/**
 * Why a mic offset change was refused: the Recording Session it belongs to is
 * shared by a Clip in a Version that is not a Draft (issue #2010). Shared by
 * the server (the refusal's message, serialized as the 409 body) and the
 * browser (which matches on it to show the refusal in the Mic Settings dialog
 * instead of the fatal error overlay).
 */
export const MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE =
  "This Recording is also used by a Submitted Version; its mic offset can't change.";
