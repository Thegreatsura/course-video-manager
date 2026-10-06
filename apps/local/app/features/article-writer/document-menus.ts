import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import type { ConfirmRequest } from "@/features/action-menu/confirm-dialog";
import {
  FilePenLineIcon,
  FileTextIcon,
  FileTypeIcon,
  PlusIcon,
  SaveIcon,
} from "lucide-react";

/**
 * The writer's two document menus, shared by the standalone writer's toolbar
 * (write-toolbar.tsx) and the document panel (document-panel.tsx). Render
 * each with `<ActionMenuContent menu="dropdown" groups={…} />`.
 */

export function copyDocumentGroups(handlers: {
  onCopyAsMarkdown: () => void;
  onCopyAsRichText: () => void;
}): ActionMenuGroups {
  return {
    copy: [
      {
        label: "Copy as Markdown",
        icon: FileTextIcon,
        onSelect: handlers.onCopyAsMarkdown,
      },
      {
        label: "Copy as Rich Text",
        icon: FileTypeIcon,
        onSelect: handlers.onCopyAsRichText,
      },
    ],
  };
}

export type ReadmeFolder = "explainer" | "problem" | "solution";

/**
 * Write the document to a lesson folder's readme.md. A folder with no readme
 * gets "Write to"; one that has a readme gets "Append to" and, in `danger`,
 * "Overwrite", which confirms first because it replaces the file's content.
 */
export function readmeGroups({
  availableFolders,
  foldersWithReadme,
  onWriteToReadme,
  confirm,
}: {
  availableFolders: readonly ReadmeFolder[];
  foldersWithReadme: ReadonlySet<string>;
  onWriteToReadme: (mode: "write" | "append", folder: ReadmeFolder) => void;
  confirm: (request: ConfirmRequest) => void;
}): ActionMenuGroups {
  const exists = (folder: ReadmeFolder) => foldersWithReadme.has(folder);
  return {
    run: availableFolders.map((folder) =>
      exists(folder)
        ? {
            label: `Append to ${folder}/readme.md`,
            icon: PlusIcon,
            onSelect: () => onWriteToReadme("append", folder),
          }
        : {
            label: `Write to ${folder}/readme.md`,
            icon: SaveIcon,
            onSelect: () => onWriteToReadme("write", folder),
          }
    ),
    danger: availableFolders.filter(exists).map((folder) => ({
      label: `Overwrite ${folder}/readme.md`,
      icon: FilePenLineIcon,
      opensDialog: true,
      onSelect: () =>
        confirm({
          title: `Overwrite ${folder}/readme.md?`,
          description:
            "Its current content is replaced by this document. This cannot be undone.",
          confirmLabel: "Overwrite",
          onConfirm: () => onWriteToReadme("write", folder),
        }),
    })),
  };
}
