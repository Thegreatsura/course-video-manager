import { toast } from "@/components/ui/toast";

/**
 * The writer's clipboard buttons. Each handles its own failure (a denied
 * permission, an unfocused page) with a toast, so the click handler can stay a
 * plain `() => void` and nothing rejects unheard.
 */

/** Copy `text`; `onCopied` runs only once it is really on the clipboard. */
export const copyToClipboard = (text: string, onCopied: () => void): void => {
  navigator.clipboard.writeText(text).then(onCopied, () => {
    toast.error("Failed to copy to clipboard");
  });
};

/** Read the clipboard and hand over its text, unless it is blank. */
export const pasteFromClipboard = (onText: (text: string) => void): void => {
  navigator.clipboard
    .readText()
    .then((text) => {
      if (text.trim()) onText(text);
    })
    .catch(() => {
      toast.error("Failed to paste from the clipboard");
    });
};
