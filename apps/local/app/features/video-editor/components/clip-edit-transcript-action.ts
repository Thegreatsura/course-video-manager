import { PencilIcon } from "lucide-react";
import type { ActionLeaf } from "@/features/action-menu/action-menu-model";
import { isTranscriptionPending } from "@/features/videos/transcription-status";
import type { Clip } from "../clip-state-reducer";

/**
 * "Edit Transcript" on a Clip, in the Video and Short editors alike (#2184).
 * Only a saved Clip has text to edit, and not mid-Transcription: the
 * Transcription landing would overwrite the edit.
 */
export const clipEditTranscriptAction = (
  clip: Clip,
  onOpen: () => void
): ActionLeaf => ({
  label: "Edit Transcript",
  icon: PencilIcon,
  opensDialog: true,
  disabled:
    clip.type !== "on-database" ||
    isTranscriptionPending(clip.transcriptionStatus),
  onSelect: onOpen,
});
