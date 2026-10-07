/**
 * One-off repair for the child rows no copy path carried until the fix that
 * ships with this file: every Submit started its new Draft with no Learning
 * Goals (so no Beat -> Learning Goal links), no Clip Web Links and no
 * Transcript Words, and the loss compounded with every Submit after it.
 *
 * This file is the PURE plan; loading and writing live in
 * version-children-repair.server.ts.
 *
 * - **Learning Goals.** A Draft Section takes the live Learning Goals of the
 *   same Section (by `lineageId`) in the most recent EARLIER Version where that
 *   Section had any Learning Goal at all. Goals carry no lineage, so a goal
 *   counts as already there when the Draft Section has one with the same
 *   title. If that Draft goal is ARCHIVED, Matt deleted it in the Draft: it is
 *   never resurrected, and is reported as an ambiguity. Goals archived in the
 *   earlier Version are never restored either.
 * - **Beat links.** Each restored goal gets the links its earlier copy had,
 *   re-pointed at the Draft Beat with the same (Video lineageId, kind, title)
 *   — or, for a Beat moved to another Video, the one Beat of that kind and
 *   title in the Draft Section. A Beat with no such twin, or with several, is
 *   counted and skipped.
 * - **Clip Web Links / Transcript Words.** A live Draft Clip with none takes
 *   them from the most recent earlier copy of the same Clip that had any,
 *   matched on (Video lineageId, videoFilename, sourceStartTime,
 *   sourceEndTime) as in clip-carry-repair. Both are timed from the Clip's own
 *   start, so equal source ranges mean the rows fit verbatim.
 *
 * Only ever adds; never overwrites, deletes or un-archives.
 */

export type RepairVersioned = {
  courseId: string;
  versionId: string;
  commitState: string;
  versionCreatedAt: Date;
};

export type RepairSection = RepairVersioned & { id: string; lineageId: string };

export type RepairGoal = {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  priority: number;
  order: number;
  archived: boolean;
};

export type RepairBeat = {
  id: string;
  versionId: string;
  sectionId: string;
  videoLineageId: string;
  kind: string;
  title: string;
};

export type RepairBeatLink = { beatId: string; learningGoalId: string };

export type RepairClip = RepairVersioned & {
  id: string;
  videoLineageId: string;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

export type RepairWebLink = {
  clipId: string;
  url: string;
  title: string | null;
  capturedAt: Date;
};

export type RepairWord = {
  clipId: string;
  start: number;
  end: number;
  text: string;
};

export type RepairInput = {
  sections: RepairSection[];
  goals: RepairGoal[];
  beats: RepairBeat[];
  beatLinks: RepairBeatLink[];
  clips: RepairClip[];
  webLinks: RepairWebLink[];
  words: RepairWord[];
};

type Target = { courseId: string; versionId: string };

export type RepairPlan = {
  goals: Array<
    Target & Omit<RepairGoal, "archived"> & { fromVersionId: string }
  >;
  beatLinks: Array<Target & RepairBeatLink>;
  webLinks: Array<Target & RepairWebLink>;
  words: Array<Target & RepairWord>;
  /** Goal links whose Beat has no single twin in the Draft. */
  unmatchedBeatLinks: Array<Target & { beatTitle: string; goalTitle: string }>;
  /** Earlier goals NOT restored because the Draft has the title archived. */
  archivedInDraft: Array<Target & { sectionId: string; goalTitle: string }>;
  /** Draft Versions the plan writes to. */
  versionIds: string[];
};

const groupBy = <T, K>(rows: ReadonlyArray<T>, key: (row: T) => K) => {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
};

const isEarlier = (row: RepairVersioned, draft: RepairVersioned) =>
  row.courseId === draft.courseId &&
  row.commitState !== "draft" &&
  row.versionCreatedAt < draft.versionCreatedAt;

const newestFirst = (a: RepairVersioned, b: RepairVersioned) =>
  b.versionCreatedAt.getTime() - a.versionCreatedAt.getTime();

const clipKey = (clip: RepairClip) =>
  [
    clip.courseId,
    clip.videoLineageId,
    clip.videoFilename,
    clip.sourceStartTime,
    clip.sourceEndTime,
  ].join("\u0000");

const beatKey = (versionId: string, beat: RepairBeat) =>
  [versionId, beat.videoLineageId, beat.kind, beat.title].join("\u0000");

const planGoals = (
  input: RepairInput,
  plan: RepairPlan,
  newId: () => string
) => {
  const goalsBySection = groupBy(input.goals, (g) => g.sectionId);
  const sectionsByLineage = groupBy(
    input.sections,
    (s) => `${s.courseId}\u0000${s.lineageId}`
  );
  const linksByGoal = groupBy(input.beatLinks, (l) => l.learningGoalId);
  const beatById = new Map(input.beats.map((b) => [b.id, b]));
  const beatsByKey = groupBy(input.beats, (b) => beatKey(b.versionId, b));
  const beatsBySectionTitle = groupBy(
    input.beats,
    (b) => `${b.sectionId}\u0000${b.kind}\u0000${b.title}`
  );
  /** The single Draft Beat an earlier Beat became, if there is exactly one. */
  const draftTwin = (earlier: RepairBeat, draftSection: RepairSection) => {
    const sameVideo = beatsByKey.get(beatKey(draftSection.versionId, earlier));
    if (sameVideo) return sameVideo.length === 1 ? sameVideo[0] : undefined;
    const moved = beatsBySectionTitle.get(
      `${draftSection.id}\u0000${earlier.kind}\u0000${earlier.title}`
    );
    return moved?.length === 1 ? moved[0] : undefined;
  };

  for (const draft of input.sections) {
    if (draft.commitState !== "draft") continue;
    const source = (
      sectionsByLineage.get(`${draft.courseId}\u0000${draft.lineageId}`) ?? []
    )
      .filter((s) => isEarlier(s, draft))
      .toSorted(newestFirst)
      .find((s) => (goalsBySection.get(s.id) ?? []).length > 0);
    if (!source) continue;

    const target = { courseId: draft.courseId, versionId: draft.versionId };
    const draftGoals = goalsBySection.get(draft.id) ?? [];
    const takenOrders = new Set(
      draftGoals.filter((g) => !g.archived).map((g) => g.order)
    );
    const sourceGoals = (goalsBySection.get(source.id) ?? [])
      .filter((g) => !g.archived)
      .toSorted((a, b) => a.order - b.order);

    for (const goal of sourceGoals) {
      const twin = draftGoals.find((g) => g.title === goal.title);
      if (twin?.archived) {
        plan.archivedInDraft.push({
          ...target,
          sectionId: draft.id,
          goalTitle: goal.title,
        });
        continue;
      }
      if (twin) continue;

      const order = takenOrders.has(goal.order)
        ? Math.max(...takenOrders) + 1
        : goal.order;
      takenOrders.add(order);
      const id = newId();
      plan.goals.push({
        ...target,
        id,
        sectionId: draft.id,
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
        order,
        fromVersionId: source.versionId,
      });

      for (const link of linksByGoal.get(goal.id) ?? []) {
        const earlierBeat = beatById.get(link.beatId);
        if (!earlierBeat) continue; // archived Beat: its link went with it
        const twin = draftTwin(earlierBeat, draft);
        if (twin) {
          plan.beatLinks.push({
            ...target,
            beatId: twin.id,
            learningGoalId: id,
          });
        } else {
          plan.unmatchedBeatLinks.push({
            ...target,
            beatTitle: earlierBeat.title,
            goalTitle: goal.title,
          });
        }
      }
    }
  }
};

const planClipChildren = <R extends { clipId: string }>(
  clips: ReadonlyArray<RepairClip>,
  rows: ReadonlyArray<R>,
  push: (row: Target & R) => void
) => {
  const rowsByClip = groupBy(rows, (r) => r.clipId);
  const earlierByKey = groupBy(
    clips.filter((c) => c.commitState !== "draft" && rowsByClip.has(c.id)),
    clipKey
  );
  for (const draft of clips) {
    if (draft.commitState !== "draft" || rowsByClip.has(draft.id)) continue;
    const source = (earlierByKey.get(clipKey(draft)) ?? [])
      .filter((c) => isEarlier(c, draft))
      .toSorted(newestFirst)[0];
    if (!source) continue;
    for (const row of rowsByClip.get(source.id)!) {
      push({
        ...row,
        clipId: draft.id,
        courseId: draft.courseId,
        versionId: draft.versionId,
      });
    }
  }
};

export const planVersionChildrenRepair = (
  input: RepairInput,
  newId: () => string = () => crypto.randomUUID()
): RepairPlan => {
  const plan: RepairPlan = {
    goals: [],
    beatLinks: [],
    webLinks: [],
    words: [],
    unmatchedBeatLinks: [],
    archivedInDraft: [],
    versionIds: [],
  };
  planGoals(input, plan, newId);
  planClipChildren(input.clips, input.webLinks, (row) =>
    plan.webLinks.push(row)
  );
  planClipChildren(input.clips, input.words, (row) => plan.words.push(row));
  plan.versionIds = [
    ...new Set(
      [...plan.goals, ...plan.webLinks, ...plan.words].map((r) => r.versionId)
    ),
  ];
  return plan;
};
