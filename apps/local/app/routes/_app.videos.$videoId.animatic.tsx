import { Effect } from "effect";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { readAnimaticClipMockupFiles } from "@/services/animatic-clip-mockup-files.server";
import {
  clipMockupAudioUrl,
  clipMockupFrameUrl,
} from "@/features/clip-mockups/clip-mockup-frame-url";
import { makeLoader } from "@/services/route-action.server";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { AnimaticPlayer } from "@/features/animatic/animatic-player";
import type { AnimaticChapter } from "@/features/animatic/animatic-chapters";
import {
  AnimaticCommentsProvider,
  type AnimaticComment,
} from "@/features/animatic/animatic-comments";
import {
  clipMockupSpeechSeconds,
  type AnimaticClipMockup,
} from "@/features/animatic/animatic-timeline";
import {
  sectionRunTime,
  type AnimaticSectionLesson,
} from "@/features/animatic/animatic-section-clock";
import { AnimaticEmptyState } from "@/features/animatic/animatic-empty-state";
import {
  NO_ANIMATIC_NEIGHBOURS,
  animaticNeighbours,
  readAnimaticStartIntent,
  type AnimaticNeighbours,
  type AnimaticStartIntent,
} from "@/features/animatic/animatic-course-walk";
import { useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.animatic";

/**
 * `/videos/:videoId/animatic` — the author watches the Lesson from the
 * student's seat.
 *
 * ONE TAB OF THE VIDEO, inside the `_app` layout, so it carries the same
 * breadcrumb and PREVIOUS/NEXT as every other page of a Video. An Animatic is
 * watched a Lesson at a time and the note it produces is per Video, so walking
 * the Lesson's Videos in order is the whole motion; a page of its own outside
 * the layout made that a trip back through the editor.
 *
 * `fullscreen`, like every other page of a Video: the frame is the thing being
 * judged, so the left sidebar folds away to the floating button and the width
 * goes to the picture.
 */
export const handle = { fullscreen: true };

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const clipMockupOps = yield* ClipMockupOperationsService;
      const chapterOps = yield* ClipMockupChapterOperationsService;
      const commentOps = yield* ClipMockupCommentOperationsService;

      // The flat row: the page needs a `lineageId`, a title and a format,
      // and no part of the Lesson/Section/Version chain above them (#1671).
      const video = yield* videoOps.getVideoRowById(videoId);
      const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);

      // BOTH TABLES, not the merged `listAnimaticOrder`: that read hands back
      // positions alone, and the sidebar prints a Chapter's title. The two
      // lists are merged by their shared `order` key in
      // `buildAnimaticChapterLayout`, where the grouping arithmetic lives.
      const chapterRows =
        yield* chapterOps.listClipMockupChaptersByVideoId(videoId);
      const commentRows =
        yield* commentOps.listClipMockupCommentsByVideoId(videoId);

      // Every file is checked HERE, before anything plays. A frame or a WAV
      // the row names but the disk does not have has to be reported as
      // missing — a Clip Mockup that silently plays as a black rectangle reads
      // as a bad frame rather than as a broken file, and the author would go
      // looking in the wrong place. Checked against one directory listing per
      // Storage Root, not a stat per file: this loader is polled (#2337).
      const files = yield* readAnimaticClipMockupFiles(video.lineageId, rows);
      const mockups: AnimaticClipMockup[] = rows.map((row, index) => ({
        id: row.id,
        line: row.line,
        position: index + 1,
        durationSeconds: row.durationSeconds,
        voiceStatus: row.voiceStatus,
        voiceError: row.voiceError,
        order: row.order,
        imageUrl: clipMockupFrameUrl(row.id),
        audioUrl: clipMockupAudioUrl(row.id),
        ...files[index]!,
      }));

      const { sectionLessons, neighbours } = yield* loadCourseAround(videoId);

      return {
        sectionRunTime: sectionRunTime({
          lessons: sectionLessons,
          currentVideoId: videoId,
          currentDurationsSeconds: rows.map(clipMockupSpeechSeconds),
        }),
        video: {
          id: video.id,
          title: video.title,
          format: resolveVideoFormat(video.format),
        },
        mockups,
        neighbours,
        chapters: chapterRows.map(
          (row) =>
            ({
              id: row.id,
              name: row.name,
              order: row.order,
            }) satisfies AnimaticChapter
        ),
        comments: commentRows.map(
          (row) =>
            ({
              id: row.id,
              clipMockupId: row.clipMockupId,
              clipMockupChapterId: row.clipMockupChapterId,
              body: row.body,
            }) satisfies AnimaticComment
        ),
      };
    }),
});

/**
 * The Course around the current Video, read off one navigation tree.
 *
 * The Lessons of its Section, in Section order, each Video with the speech
 * durations of its Clip Mockups — what the Section clock sums. And its
 * NEIGHBOURS: the Videos with Clip Mockups that LEFT, RIGHT and CTRL+LEFT/RIGHT
 * walk to (`animatic-course-walk.ts`), found with one distinct read over the
 * whole Course.
 *
 * The Section is read off the Course's navigation tree, the same tree
 * PREVIOUS/NEXT walks, so the clock counts the Videos NEXT will stop on. The
 * durations are ONE query for the whole Section, not one per Video, because
 * this loader is polled every two seconds. A standalone Video has no Section,
 * and gets an empty list.
 */
const loadCourseAround = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;
    const clipMockupOps = yield* ClipMockupOperationsService;
    const nothingAround = {
      sectionLessons: [] as AnimaticSectionLesson[],
      neighbours: NO_ANIMATIC_NEIGHBOURS as AnimaticNeighbours,
    };

    const video = yield* videoOps.getVideoWithLessonById(videoId);
    const lesson = video.lesson;
    if (!lesson) return nothingAround;

    const courseNav = yield* courseOps.getCourseNavigationData(
      lesson.section.repoVersion.repo.id
    );
    const sections = courseNav.versions[0]?.sections ?? [];
    const section = sections.find(
      (candidate) => candidate.id === lesson.section.id
    );
    if (!section) return nothingAround;

    const courseSections = sections.map((s) => ({
      videoIds: s.lessons.flatMap((l) => l.videos.map((v) => v.id)),
    }));
    const withClipMockups = yield* clipMockupOps.listVideoIdsWithClipMockups(
      courseSections.flatMap((s) => s.videoIds)
    );
    const neighbours = animaticNeighbours({
      sections: courseSections,
      withClipMockups: new Set(withClipMockups),
      currentVideoId: videoId,
    });

    const videoIds = section.lessons.flatMap((l) => l.videos.map((v) => v.id));
    const durationRows =
      yield* clipMockupOps.listClipMockupDurationsByVideoIds(videoIds);
    const durationsByVideo = new Map<string, number[]>();
    for (const row of durationRows) {
      const list = durationsByVideo.get(row.videoId) ?? [];
      list.push(clipMockupSpeechSeconds(row));
      durationsByVideo.set(row.videoId, list);
    }

    const sectionLessons = section.lessons.map((l): AnimaticSectionLesson => ({
      videos: l.videos.map((v) => ({
        id: v.id,
        title: v.title,
        durationsSeconds: durationsByVideo.get(v.id) ?? [],
      })),
    }));
    return { sectionLessons, neighbours };
  });

export default function AnimaticRoute({ loaderData }: Route.ComponentProps) {
  const { video, mockups, neighbours, chapters, comments, sectionRunTime } =
    loaderData;
  const { startAnimaticExport } = useUploadActions();
  const navigate = useNavigate();

  // Arrived by a walk from another Animatic (`animatic-course-walk.ts`): open
  // at the end it asked for, and play. Arrived any other way: at the top,
  // paused, as ever.
  const start = readAnimaticStartIntent(useLocation().state);
  const startAt =
    start === null
      ? undefined
      : (start === "first" ? mockups[0] : mockups[mockups.length - 1])?.id;

  // An Animatic is WATCHED WHILE IT IS STILL BEING WRITTEN — an agent redraws a
  // frame or rewrites a line in the background, and the author should see it on
  // the next loop rather than after a reload. Same hook, same shape as the
  // Course view, plus a short interval because the edits arrive one at a time.
  //
  // The poll is only safe because `useStableMockups` in the player holds the
  // rows by value: a revalidation that found no change reaches the Player as
  // the identical props it already has, so playback is never restarted. Do not
  // remove that guard while this poll exists.
  useFocusRevalidate({ intervalMs: 2000 });

  if (mockups.length === 0) {
    return <AnimaticEmptyState videoId={video.id} />;
  }

  return (
    // KEYED BY THE VIDEO, so NEXT starts the next Animatic at its first frame.
    // This is one route: PREVIOUS/NEXT changes `:videoId` alone, React keeps
    // the same `AnimaticPlayer` mounted, and everything the player holds —
    // the Remotion Player's own playhead above all — survives the move. Walk
    // off clip seven while it plays and the next Video picks up playing at
    // clip seven, halfway through a Lesson the author has not started
    // watching. The editor keys itself the same way, for the same reason.
    //
    // A POLL MUST NOT REMOUNT IT. The `videoId` is the one thing a
    // revalidation of this page cannot change, which is why the key is the
    // Video and not the rows; the rows are held by value instead, in
    // `useStableMockups`. Comments reach the sidebar through their own
    // provider, so they are never part of what the Player is handed.
    <AnimaticCommentsProvider comments={comments}>
      <AnimaticPlayer
        key={video.id}
        mockups={mockups}
        chapters={chapters}
        sectionRunTime={sectionRunTime}
        format={video.format}
        startAt={startAt}
        courseWalk={{
          neighbours,
          // A real route change, so the URL names the Video now playing.
          onOpen: (videoId, animaticStart) => {
            const state: AnimaticStartIntent = { animaticStart };
            void navigate(`/videos/${videoId}/animatic`, { state });
          },
        }}
        onExport={() =>
          startAnimaticExport(video.id, `${video.title} (Animatic)`)
        }
      />
    </AnimaticCommentsProvider>
  );
}
