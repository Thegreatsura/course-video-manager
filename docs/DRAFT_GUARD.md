# The Draft guard

The detail behind "A write to anything a Version owns goes through the Draft
guard" in [`CODING_STANDARDS.md`](../CODING_STANDARDS.md).

A Section, a Lesson, a Video and everything hanging off them belong to a
CourseVersion, and only a Draft accepts writes: Pending and Published Versions
are immutable. `packages/core/services/draft-guard.server.ts` is the single
place that decides this. Every DB write entry point resolves its target's owning
Version through the `requireDraftVersionFor…` that matches the noun it is
writing, and fails with a typed `VersionNotDraftError` when the Version is not a
Draft. The guard reads `commitState` with a `SELECT … FOR UPDATE`, so it is
only race-safe inside the SAME transaction as the write it protects.

**A NEW NOUN INHERITS THE GUARD FROM WHAT IT HANGS OFF.** If a row points at a
Video, a Clip or a Section, then a Version owns it too, however far from the
Course the noun feels while you are building it. Add its
`requireDraftVersionFor<Noun>` beside the others and call it from every write —
create, update, move and archive alike.

The guard's second job is the one that gets missed: it is the only thing that
catches a **stranded write**, a write that names a superseded row, succeeds, and
lands where nobody is looking. A Version copy gives every Video a new id, and
the old id still resolves, still names a real Video with the right title, and
still takes writes.

What the omission costs, from this repo: Clip Mockups and Clip Mockup Chapters
were left outside the closure on purpose, on the reasoning that a Clip Mockup is
pre-filming authoring data and sits outside the published write-closure. A
Version copy then gave one course a set of Draft Videos. Half an hour later an
authoring run wrote 190 Clip Mockups across six of those Videos — onto the
`v0.0.1` rows, a **published** Version — and ten hours after that a second run
wrote 57 Chapters onto eleven of them the same way. Every one of those ~250
writes succeeded and returned a row. The author opened the Animatic on the
Draft, which is the Version the app shows, and saw no Chapters and no Chapter
controls at all, because those controls hide themselves when a Video has none.
`requireDraftVersionForVideo` would have refused the first write of the first
run and the whole thing would have stopped there. The write-closure reasoning
was sound; it just did not account for a stranded write.

A noun survives review without a guard only when no Version owns it — a
standalone or pitch-bound Video belongs to no CourseVersion, and the guard
already passes for that case rather than needing to be skipped. "This noun is
not part of the published artifact" is not the test; "no row above this one
reaches a CourseVersion" is.
