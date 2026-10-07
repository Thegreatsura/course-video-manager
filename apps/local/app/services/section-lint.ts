/**
 * Section Lint — the section-authoring quality bar, as code.
 *
 * Five checks over ONE Section's Learning Goals and the Beats across all its
 * Lessons' Videos. Pure and derived, never stored — the same category as
 * beat-learning-goal-warnings.ts (whose two predicates this reuses outright)
 * and video-warnings.ts.
 *
 * WHY THIS IS NOT `course readiness`. Readiness answers "what stands between
 * this Course and SHIPPING", course-scoped, over Lesson/Video fields that reach
 * published output. These five are PLANNING-stage questions about one Section's
 * Goal-to-Beat linkage and Beat shape — fields (a Beat, its description, a
 * Learning Goal) that Publish never emits. CONTEXT.md is explicit that a Beat
 * Warning is "deliberately excluded from Publish Readiness": a planning nag,
 * not a publish blocker. So this is a separate verb with a separate output, and
 * nothing here is bolted onto readiness.
 *
 * CONSEQUENTLY A FINDING IS NOT A FAILURE. `cvm section lint` reports findings
 * on STDOUT and exits 0, exactly as `course readiness` reports 266 lints and
 * exits 0. A non-zero exit would say "the command could not answer", which is
 * a different fact from "the Section has three stub Beats".
 */

import type { BeatKind } from "@/features/beats/beat-kinds";
import {
  computeBeatWarnings,
  computeLearningGoalWarnings,
  sectionHasLearningGoals,
} from "./beat-learning-goal-warnings";

// ---------------------------------------------------------------------------
// Input — the Section's planning tree, already fetched and de-archived
// ---------------------------------------------------------------------------

export interface SectionLintBeat {
  readonly id: string;
  readonly title: string;
  readonly kind: BeatKind;
  readonly description: string;
  readonly learningGoalIds: readonly string[];
}

export interface SectionLintVideo {
  readonly id: string;
  readonly title: string;
  readonly beats: readonly SectionLintBeat[];
}

export interface SectionLintLesson {
  readonly id: string;
  readonly title: string;
  readonly videos: readonly SectionLintVideo[];
}

export interface SectionLintInput {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly learningGoals: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly lessons: readonly SectionLintLesson[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The five checks, in report order. Doubles as the vocabulary of
 * `failedChecks` — an agent can branch on these names without parsing prose.
 */
export const SECTION_LINT_CHECKS = [
  "noLearningGoals",
  "orphanedLearningGoals",
  "unlinkedBeats",
  "stubBeats",
  "questlessLessons",
] as const;

export type SectionLintCheck = (typeof SECTION_LINT_CHECKS)[number];

/** A Learning Goal no Beat in the Section serves. */
export interface OrphanedLearningGoal {
  readonly id: string;
  readonly title: string;
}

/** A Beat, located by the Lesson and Video it sits in. */
export interface SectionLintBeatFinding {
  readonly id: string;
  readonly title: string;
  readonly kind: BeatKind;
  readonly videoId: string;
  readonly videoTitle: string;
  readonly lessonId: string;
  readonly lessonTitle: string;
}

/** A Lesson with no Quest Beat, plus the per-Lesson distribution it came from. */
export interface QuestPacingLesson {
  readonly id: string;
  readonly title: string;
  readonly quests: number;
}

export interface SectionLintReport {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly clean: boolean;
  readonly failedChecks: ReadonlyArray<SectionLintCheck>;
  readonly counts: Record<SectionLintCheck, number>;
  /** The Section has no Learning Goals at all — nothing for a Beat to serve. */
  readonly noLearningGoals: boolean;
  readonly orphanedLearningGoals: ReadonlyArray<OrphanedLearningGoal>;
  readonly unlinkedBeats: ReadonlyArray<SectionLintBeatFinding>;
  readonly stubBeats: ReadonlyArray<SectionLintBeatFinding>;
  readonly questlessLessons: ReadonlyArray<QuestPacingLesson>;
  readonly questPacing: {
    readonly totalQuests: number;
    readonly lessons: ReadonlyArray<QuestPacingLesson>;
  };
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

interface LocatedBeat extends SectionLintBeat {
  readonly videoId: string;
  readonly videoTitle: string;
  readonly lessonId: string;
  readonly lessonTitle: string;
}

const locate = (beat: LocatedBeat): SectionLintBeatFinding => ({
  id: beat.id,
  title: beat.title,
  kind: beat.kind,
  videoId: beat.videoId,
  videoTitle: beat.videoTitle,
  lessonId: beat.lessonId,
  lessonTitle: beat.lessonTitle,
});

/** Flatten the Section's Lessons -> Videos -> Beats, keeping each Beat's address. */
const flattenBeats = (
  lessons: SectionLintInput["lessons"]
): ReadonlyArray<LocatedBeat> =>
  lessons.flatMap((lesson) =>
    lesson.videos.flatMap((video) =>
      video.beats.map((beat) => ({
        ...beat,
        videoId: video.id,
        videoTitle: video.title,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
      }))
    )
  );

export const computeSectionLint = (
  input: SectionLintInput
): SectionLintReport => {
  const beats = flattenBeats(input.lessons);
  const hasGoals = sectionHasLearningGoals(input.learningGoals);

  // 1. ORPHANED LEARNING GOALS — a Goal no Beat anywhere in the Section serves.
  // Delegated to the same predicate the course view's Learning Goal Warning
  // uses, so the CLI and the UI can never disagree about what "orphaned" means.
  const orphanedLearningGoals = input.learningGoals
    .filter(
      (goal) =>
        computeLearningGoalWarnings({ learningGoalId: goal.id, beats }).length >
        0
    )
    .map((goal) => ({ id: goal.id, title: goal.title }));

  // 2. UNLINKED BEATS — a non-`setup` Beat serving no Learning Goal. Same
  // delegation, so the `setup` exemption is stated in exactly one place
  // (beat-learning-goal-warnings.ts). The Beat Warning's OTHER exemption — a
  // Section with no Goals yet — is deliberately NOT taken here: the course view
  // keeps quiet about a Section nobody has planned, but lint is the quality
  // bar, and a Section whose Beats serve nothing is exactly what it must catch
  // (it once reported a Section with no Goals and no linked Beat as clean).
  // `noLearningGoals` names the cause; this lists every Beat it leaves loose.
  const unlinkedBeats = beats
    .filter(
      (beat) =>
        computeBeatWarnings({
          kind: beat.kind,
          sectionHasLearningGoals: true,
          learningGoalIds: beat.learningGoalIds,
        }).length > 0
    )
    .map(locate);

  // 3. STUB BEATS — an empty or whitespace-only Beat Description. A Beat with a
  // title and no description is a placeholder someone meant to come back to:
  // it carries no plan, so nothing downstream (Script, filming) can use it.
  // Applies to EVERY kind, `setup` included — a Setup Beat with no note says
  // nothing about what the playground repo needs.
  const stubBeats = beats
    .filter((beat) => beat.description.trim().length === 0)
    .map(locate);

  // 4. QUEST PACING — Quests spread across the Section's Lessons, not bunched.
  // Measured as quests-per-Lesson: a Lesson with none, while the Section has
  // Quests elsewhere, is where the bunching shows. A Section with NO Quest Beat
  // at all is exempt — that is "no quests planned yet", an earlier and
  // different problem, and firing on every Lesson of an unstarted Section would
  // drown the other checks.
  const perLesson: QuestPacingLesson[] = input.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    quests: lesson.videos.reduce(
      (n, video) => n + video.beats.filter((b) => b.kind === "quest").length,
      0
    ),
  }));
  const totalQuests = perLesson.reduce((n, l) => n + l.quests, 0);
  const questlessLessons =
    totalQuests === 0 ? [] : perLesson.filter((lesson) => lesson.quests === 0);

  const lists = {
    orphanedLearningGoals,
    unlinkedBeats,
    stubBeats,
    questlessLessons,
  };

  // 0. NO LEARNING GOALS — the Section has none at all, so no Beat can serve
  // one and orphanedLearningGoals can never fire.
  const noLearningGoals = !hasGoals;

  const failedChecks = SECTION_LINT_CHECKS.filter((check) =>
    check === "noLearningGoals" ? noLearningGoals : lists[check].length > 0
  );

  return {
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    clean: failedChecks.length === 0,
    failedChecks,
    counts: {
      noLearningGoals: noLearningGoals ? 1 : 0,
      orphanedLearningGoals: orphanedLearningGoals.length,
      unlinkedBeats: unlinkedBeats.length,
      stubBeats: stubBeats.length,
      questlessLessons: questlessLessons.length,
    },
    noLearningGoals,
    ...lists,
    questPacing: { totalQuests, lessons: perLesson },
  };
};
