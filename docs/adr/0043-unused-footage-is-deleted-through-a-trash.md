---
status: accepted
---

# Unused Footage is deleted through a trash

Decided by Matt on #2157. Amends decision 3 of [ADR 0041](0041-storage-moves-keep-originals-and-never-delete-footage.md), which said Unused Footage could only be moved.

## Context

About 104 GB of raw **Footage** on D: is used by no **Clip**. ADR 0041 made all Footage undeletable from the Storage page, because Footage is the one thing CVM cannot make again. Matt wants the Unused part gone, without giving up that protection for anything a Clip, or a Clip that could be restored, still needs.

## Decision

1. **Unused means no Clip at all.** A file is Unused Footage only if no Clip, live or archived, in any **Video** uses it. Footage used only by archived Clips stays, because those Clips can be restored. What uses what is read fresh from the database when the delete runs, never taken from the page.
2. **Nothing recent.** A **Recording Session** still recording, or under 7 days old, is never offered, nor is anything else in its folder; neither is any file changed in the last 7 days. An **AV Calibration**'s files and a Video's original footage path are kept too.
3. **The Trash comes first.** Deleting Unused Footage renames each file into `<root>/.cvm-trash/<batch>/<its root-relative path>` on its own **Storage Root**. It is a rename, never a copy, and it is refused if the trash is on another device, so a file never crosses drives. Restore puts a file back at its old path, never over anything. Trash older than 14 days is deleted for good (its age is read from the batch's name); "Empty trash" deletes it now.
4. **Same path safety as every other delete.** A file must be a regular file (never a link) whose real path is exactly where its root-relative path says, under the real `raw-footage/` of a real root; the trash folder must really be on that root. Every trash operation refuses while an export, a Publish, a move, a transcription, another delete or a recording is queued or running.

## Alternatives rejected

- **Delete Unused Footage at once.** One wrong reading of the database (a Clip copied into a new Draft a moment later, a Recording Session whose Clips are not saved yet) would lose a take for good. The trash costs 14 days of space.
- **A trash folder on the first root for every drive.** Moving E:'s files to D:'s trash is a copy across drives, slow and able to fail half-way, the opposite of what a delete should be.
- **Count archived Clips as unused.** An archived Clip can be restored, and then its Footage must be there.

## Consequences

- Space is freed in two steps (trash, then 14 days or "Empty trash"), and the drive's free space only grows at the second.
- The trash is outside the folders the Storage page counts, so it is not in any **Storage Bucket**; it is shown and emptied on its own.
- A Recording Session row whose files went to the trash still names them; restoring puts them back where it looks.
