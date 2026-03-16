# Ubiquitous Language

| Term                  | Definition                                                                                                                   | Aliases to avoid                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Repo**              | A file-system directory (typically a git repository) containing the full structure of a course                               | Course (as an entity name), Project |
| **RepoVersion**       | A named snapshot of a repo's section/lesson structure at a point in time                                                     | Version (too vague), Revision       |
| **Section**           | A directory-backed grouping of lessons within a repo version, ordered by fractional index                                    | Module, Chapter, Unit               |
| **Lesson**            | A single learning unit within a section, corresponding to a folder on disk                                                   | Exercise, Tutorial, Step            |
| **Ghost Lesson**      | A lesson that exists in the database but not yet on the file system (`fsStatus = "ghost"`)                                   | Planned lesson, Draft lesson        |
| **Ghost Section**     | A section that exists in the database but not yet on the file system                                                         | Planned section                     |
| **Video**             | A container of clips and clip sections that represents a single producible video output                                      | Recording                           |
| **Standalone Video**  | A video with no lesson association (`lessonId = NULL`), used for reference or temporary content                              | Orphan video, Unlinked video        |
| **Clip**              | A timestamped segment of source footage within a video, defined by start/end times and a source filename                     | Segment, Cut, Take                  |
| **Effect Clip**       | A special clip for non-speech content (white noise, transitions) manually inserted into the timeline                         | Filler, Spacer                      |
| **ClipSection**       | A named marker/divider within a video's timeline that visually groups related clips                                          | Clip group, Divider, Marker         |
| **Optimistic Clip**   | A clip added to the frontend state during recording before it is persisted to the database                                   | Pending clip, Temporary clip        |
| **Recording Session** | A time-bounded window during which clips are captured via OBS, grouping optimistic clips before persistence                  | Session, Take session               |
| **Insertion Point**   | The position in a video timeline where new clips or clip sections will be added (start, after-clip, after-clip-section, end) | Cursor, Drop target                 |
| **Plan**              | An independent (non-file-backed) structured course outline, separate from the repo hierarchy                                 | Outline, Syllabus                   |
| **PlanSection**       | A grouping within a plan                                                                                                     | -                                   |
| **PlanLesson**        | A learning objective within a plan section                                                                                   | -                                   |
| **Archive**           | Soft-deletion: hiding an entity from active views while retaining it in the database                                         | Delete, Remove                      |
| **ARCHIVE Section**   | A special section directory whose name ends in `ARCHIVE`, filtered out of the default course view                            | -                                   |
| **Fractional Index**  | A string-based ordering value that allows inserting items between existing items without reindexing siblings                 | Sort order, Position                |
| **Transcription**     | The process of populating a clip's `text` field from its audio, tracked by `transcribedAt`                                   | Caption, Subtitle                   |

## Relationships

- A **Repo** contains one or more **RepoVersions**
- A **RepoVersion** contains ordered **Sections**
- A **Section** contains ordered **Lessons**
- A **Lesson** contains one or more **Videos**
- A **Video** contains ordered **Clips** and **ClipSections**, interleaved in a shared ordering space
- A **Standalone Video** belongs directly to a **Repo** with no **Lesson** parent
- A **Recording Session** produces multiple **Optimistic Clips** that become **Clips** on persistence
- A **Plan** is independent of the **Repo** hierarchy and contains **PlanSections** with **PlanLessons**

## Example dialogue

> **Dev:** "When a user creates a new **Lesson** inside a **Section**, does it always exist on disk?"

> **Domain expert:** "No. It starts as a **Ghost Lesson** -- it's in the database with `fsStatus = 'ghost'` but there's no directory yet. The user can plan titles, ordering, and dependencies before anything hits the file system."

> **Dev:** "And when they start recording, is the **Video** created at that point?"

> **Domain expert:** "The **Video** already exists once the **Lesson** is set up. When they hit record, a **Recording Session** begins. Each captured segment becomes an **Optimistic Clip** in the UI immediately, then gets persisted as a real **Clip** with `sourceStartTime` and `sourceEndTime` from the footage file."

> **Dev:** "What about videos that aren't part of any lesson?"

> **Domain expert:** "Those are **Standalone Videos**. They sit at the **Repo** level with no `lessonId`. You can later move a **Standalone Video** into a **Lesson** through the UI."

## Flagged ambiguities

- **"Course" vs "Repo"** -- The application is named "Course Video Manager" and services like `CourseWriteService` use "Course", but the database entity is `repos`. Recommend using **Repo** in code and domain discussions, reserving "course" for user-facing prose only.
- **"Version"** -- Used both for **RepoVersion** (structural snapshots) and implicitly for content history via `previousVersionLessonId`/`previousVersionSectionId` cross-references. These serve different purposes: one is a named milestone, the other is a migration link between versions.
- **Clips and ClipSections share an ordering space** -- Both use the same `order` field with fractional indexing. The UI must treat them as a single interleaved list, not two separate collections. This is a source of complexity when inserting or reordering.
- **"Plan" vs course structure** -- A **Plan** (`plans` table) is entirely disconnected from the **Repo**/Section/Lesson hierarchy. There is no enforced link between a **PlanLesson** and an actual **Lesson**. The relationship is purely semantic.
