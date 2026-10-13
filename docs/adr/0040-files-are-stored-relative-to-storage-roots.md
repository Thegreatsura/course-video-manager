---
status: accepted
---

# Files are stored relative to Storage Roots

Decided by Matt on #2103 (the Storage Manager spec). Implemented by #2104.

## Context

D: holds every byte CVM makes and is 92% full. E: has room, but CVM could not use it: the database stored ABSOLUTE paths (`/mnt/d/raw-footage/…`) on about 141k Clip rows and every other path column, so moving a file broke the rows that named it. Worse, the **Export Hash** included each Footage file's absolute path, so rewriting a path would make every Video an **Unexported Video**, and export garbage collection would then delete about 98 GB of exports to be encoded again.

## Decision

1. **One ordered setting, `STORAGE_ROOTS`** (`/mnt/d,/mnt/e`), read in one place (`apps/local/app/services/storage-roots.ts`). Every root has the same fixed folders. The old FINISHED_VIDEOS_DIRECTORY, CLIP_MOCKUP_DIR and OVERLAY_RENDER_CACHE_DIRECTORY settings are gone: they are `finished-videos/`, `clip-mockups/` and `overlay-renders/` under the first root.
2. **The database stores paths relative to a root, with no drive.** Every read resolves a stored path by trying each root in order; the first that has the file wins (`@/packages/storage`). A legacy absolute path under a root is read as its relative form, so the code is correct before and after the data migration, and no contract-first sequence is needed (ADR 0026). An absolute path under no root (a Recording Session in `~/Videos`, a repo asset) is used exactly as stored. New files are written to the first root.
3. **The Export Hash names Footage by its root-relative path.** A legacy absolute path is normalized first. A file's address therefore does not depend on which root holds it, or on whether its row has been migrated. Every other input to the hash is unchanged.
4. **Every Export Hash changes once, and the exports are renamed rather than re-encoded.** A one-off script renames each Exported Video (and its `.sha256` digest) from its old address to its new one. It is a dry run by default and refuses the whole rename, changing nothing, if any Course-named export cannot be matched, a new name is taken, or two exports collide.
5. **Export garbage collection is off until that rename has completed.** The rename writes a marker (`finished-videos/.export-hash-root-relative.json` on the first root); GC deletes nothing without it. Between deploying this and running the rename, every export on disk is named by a hash no Video computes, and GC would otherwise delete them all.
6. **The data migration goes around the Draft guard on purpose.** Version freeze is enforced in app code only (docs/DRAFT_GUARD.md). A Published Version's Clips name the same Footage as its Draft's, so they are rewritten too; their Export Hashes do not change, so no frozen content changes. It is idempotent, and a dry run by default.
7. **Matt runs both scripts himself**, from main. Agents write and test them against temp directories and PGlite only.

## Consequences

- Moving a file between roots changes no row and no Export Hash. Moving Footage and exports is the next Storage Manager ticket.
- A file on no reachable root fails the export, the editor's playback and the stills with "Footage not found (E: offline?)".
- The next Publish of each Course writes new Bundle addresses, because the Export Hash is part of them; the **Byte Hash** still decides the send, so unchanged bytes are copied, not uploaded (ADR 0027).
- `thumbnail.file_path`, Video Files and Recording Sessions in `~/Videos` were not under a root; #2105 moved where new ones go. New CVM-recorder Recording Sessions (and AV Calibration runs) are written to `raw-footage/` on the first root, and Video Files and Thumbnails to `video-files/`, all stored root-relative. Existing ones stay where they are, still read there, until `pnpm storage:relocate` (Matt runs it, #2106) moves them, rewrites their rows and renames the Exported Videos whose Export Hash the move changes. It refuses to run before `storage:rename-exports`.
- New OBS Clips are still written with the absolute path OBS reports. That is read and hashed exactly as its relative form would be; the migration can be re-run at any time to rewrite such rows.
