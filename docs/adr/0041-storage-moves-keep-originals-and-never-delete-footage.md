---
status: accepted
---

# Storage moves keep originals and never delete Footage

Decided by Matt on #2103 (the Storage Manager spec). Builds on [ADR 0040](0040-files-are-stored-relative-to-storage-roots.md).

## Context

D: is 92% full and E: (an external USB drive) has room. ADR 0040 made every stored path relative to a **Storage Root**, so a file can be on either drive without any row or **Export Hash** changing. The Storage page now lets Matt see what each **Storage Bucket** uses on each drive, move it, and delete what can be made again. Raw **Footage** cannot be made again, and E: has a history of I/O retries and a dirty exFAT volume, so every rule below leans towards never losing a take.

## Decision

1. **Paths are root-relative and resolved across the ordered Storage Roots** (ADR 0040). A move copies files from one root to another; it changes no row and no Export Hash. While a file is on both roots, the first root's copy wins, which is harmless.
2. **Any Storage Bucket can be on any mix of drives.** The page shows each bucket's bytes on every root, and moves its Footage or its **Exported Videos** in either direction, as one.
3. **Raw Footage is never deletable**, from the Storage page or anywhere else. **Unused Footage** can only be moved. (Amended by [ADR 0043](0043-unused-footage-is-deleted-through-a-trash.md): Unused Footage can now be deleted; since #2423, for good after a confirmation, with no trash.) Exported Videos can be deleted (a **Purge**), because they are a cache of the Footage, but only for a Video whose Footage is all found. The **Overlay Render Cache**, export scratch and Exported Videos of no current Video can be deleted. **Clip Mockups** can only be moved.
4. **A move keeps the originals.** Each file is copied, then its checksum is compared with the original's. The originals stay until Matt clicks "Delete originals", which deletes a file only when an identical copy (size and checksum) is on another root. Files Windows will not let go of are left and reported.
5. **Sizes are never cached.** The Storage page scans the roots every time it is opened, streams the totals in as it counts them, and stops scanning when Matt leaves the page. (Amended by #2423: a scan or listing is kept in memory for five minutes while the app is open, and Refresh scans at once; nothing is kept across a reload or on the server.)

## Alternatives rejected

- **Storing the drive on each row.** Every move would rewrite rows (about 141k Clips), the Export Hash would have to ignore part of a column, and an unplugged drive would leave rows pointing at nothing. Resolving across ordered roots keeps the database ignorant of drives.
- **One drive per Course.** Simpler to show, but **Shared Footage** belongs to several Courses at once, and Matt wants to move only the heavy part (Footage or Exported Videos) of a Course. Buckets may be split across drives instead.
- **Deleting originals automatically once the checksum matches.** It frees D: with no extra click, but E:'s health is not trusted yet, and the original on D: is then the only good copy of raw Footage. It can be turned on later, once E: has proved itself; the "Delete originals" button stays either way.
- **Caching sizes.** A saved size goes stale the moment a file is recorded, exported or moved. A fresh count, streamed in as it is made, is never wrong.

## Consequences

- Freeing D: takes two steps: move, then "Delete originals". Until the second, the space is used twice.
- No action on the Storage page can lose raw Footage; the worst a mistake costs is an export or a render.
- A Video whose Footage is on an unplugged drive cannot be exported, and its Exported Video cannot be purged, until the drive is back.
- Each visit to the Storage page reads every root, including a slow USB drive.
