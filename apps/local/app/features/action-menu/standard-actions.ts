import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ClipboardCopy,
  CopyPlus,
  Download,
  ExternalLink,
  FolderOpen,
  PencilIcon,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The shared vocabulary of action menus: one label and one icon per action,
 * the same in every menu (CODING_STANDARDS.md, "Action menus"). Spread one
 * into a group and add the rest:
 *
 *   edit: [{ ...STANDARD_ACTIONS.rename, opensDialog: true, onSelect }]
 *
 * An action whose label names something else ("Add Lesson", "Copy
 * Transcript") keeps that noun; it only drops the menu's own entity.
 */
export const STANDARD_ACTIONS = {
  /** open */
  open: { label: "Open", icon: ExternalLink },
  revealInFileSystem: { label: "Reveal in File System", icon: FolderOpen },
  /** edit */
  rename: { label: "Rename", icon: PencilIcon },
  edit: { label: "Edit", icon: PencilIcon },
  /** create — "Add <Noun>", "Add <Noun> Before/After" use `add`'s icon. */
  add: { label: "Add", icon: Plus },
  duplicate: { label: "Duplicate", icon: CopyPlus },
  /** move */
  moveUp: { label: "Move Up", icon: ArrowUp },
  moveDown: { label: "Move Down", icon: ArrowDown },
  moveTo: { label: "Move to", icon: ArrowRightLeft },
  /** run */
  export: { label: "Export", icon: Download },
  /** copy — "Copy <Thing>" puts <Thing> on the clipboard, nothing else. */
  copy: { label: "Copy", icon: ClipboardCopy },
  /** danger */
  archive: { label: "Archive", icon: Archive },
  unarchive: { label: "Unarchive", icon: ArchiveRestore },
  delete: { label: "Delete", icon: Trash2 },
  removeFrom: { label: "Remove from", icon: Unlink },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;
