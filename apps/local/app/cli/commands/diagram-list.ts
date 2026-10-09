import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  readSimpleDiagram,
  type SceneStore,
} from "@cvm/core/lib/simple-diagram/index";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { entityDeepLink } from "@/features/entity-links/entity-deep-link";
import { detail, emitNdjson } from "@/cli/helpers";
import { resolveAppUrl } from "@/cli/env";
import {
  COMPONENT_HELP,
  COMPONENT_LIST_HELP,
  LIST_HELP,
} from "./diagram-list.help";

/**
 * `cvm diagram list` and `cvm diagram component list`: READ-ONLY, so an agent
 * can see Matt's real Diagrams and Components before it draws one. Neither
 * writes anything — not even a Component's recency (`listComponentFragments`
 * is a read, unlike the palette's insert).
 */

/** How much of a snapshot's words a search hit shows around the match. */
const SNIPPET_RADIUS = 60;

/**
 * The part of `text` around the first query word it contains. The palette's
 * search is Postgres full-text (stemmed), so a hit may not contain a query
 * word verbatim; then the start of the text is shown.
 */
export const snippet = (text: string, query: string): string => {
  const lower = text.toLowerCase();
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => lower.indexOf(w))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (at ?? 0) - SNIPPET_RADIUS);
  const end = Math.min(text.length, (at ?? 0) + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
};

type Hit = {
  snapshotId: string | null;
  diagramId: string;
  diagramName: string;
  searchText: string | null;
  source: "snapshot" | "current";
};

/**
 * Which part of each Diagram a search matched, from the palette's own
 * `searchDiagrams` hits: its name (a case-insensitive substring, as the
 * search's own name match is), the words of its head, and of each snapshot.
 */
export const matchesByDiagram = (hits: readonly Hit[], query: string) => {
  const q = query.toLowerCase();
  const byDiagram = new Map<
    string,
    {
      name: boolean;
      head?: string;
      snapshots: Array<{ id: string; text: string }>;
    }
  >();
  for (const hit of hits) {
    const nameMatched = hit.diagramName.toLowerCase().includes(q);
    const entry = byDiagram.get(hit.diagramId) ?? {
      name: nameMatched,
      snapshots: [],
    };
    const text = hit.searchText ?? "";
    if (hit.source === "snapshot" && hit.snapshotId) {
      entry.snapshots.push({ id: hit.snapshotId, text: snippet(text, query) });
    } else if (!nameMatched || text.toLowerCase().includes(q)) {
      // A head hit is the name, its words, or both: show the words only when
      // they are what matched.
      if (text) entry.head = snippet(text, query);
    }
    byDiagram.set(hit.diagramId, entry);
  }
  return byDiagram;
};

const listCmd = Command.make(
  "list",
  {
    query: Args.text({ name: "query" }).pipe(Args.optional),
    archived: Options.boolean("archived").pipe(
      Options.withDescription("Include archived (deleted) Diagrams.")
    ),
  },
  ({ query, archived }) =>
    Effect.gen(function* () {
      const diagrams = yield* DiagramOperationsService;
      const summaries = yield* diagrams.listDiagramSummaries({
        includeArchived: archived,
      });
      const appUrl = resolveAppUrl();
      const row = (d: (typeof summaries)[number]) => ({
        id: d.id,
        name: d.name,
        snapshotCount: d.snapshotCount,
        filmed: d.filmed,
        ...(archived ? { archived: d.archived } : {}),
        url: entityDeepLink({ type: "diagram", id: d.id }, appUrl),
      });

      const q = Option.getOrUndefined(query)?.trim();
      if (!q) {
        yield* emitNdjson(summaries.map(row));
        return;
      }

      const matches = matchesByDiagram(yield* diagrams.searchDiagrams(q), q);
      // Search order (most recently filmed or edited first), not list order.
      const byId = new Map(summaries.map((d) => [d.id, d]));
      const rows = [...matches.entries()].flatMap(([id, matched]) => {
        const d = byId.get(id);
        return d ? [{ ...row(d), matched }] : [];
      });
      yield* emitNdjson(rows);
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

/**
 * A Component's saved fragment (tldraw's `getContentFromCurrentPage`:
 * `{ shapes, bindings, … }`) as the store `readSimpleDiagram` reads.
 */
export const fragmentStore = (fragment: unknown): SceneStore => {
  const f = (fragment ?? {}) as { shapes?: unknown; bindings?: unknown };
  const records = [
    ...(Array.isArray(f.shapes) ? f.shapes : []),
    ...(Array.isArray(f.bindings) ? f.bindings : []),
  ] as Array<{ id?: unknown }>;
  return Object.fromEntries(
    records
      .filter((r) => r && typeof r.id === "string")
      .map((r) => [r.id as string, r])
  ) as SceneStore;
};

const componentListCmd = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const components = yield* DiagramComponentOperationsService;
    const rows = yield* components.listComponentFragments();
    yield* emitNdjson(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        shapes: readSimpleDiagram(fragmentStore(c.sceneFragment)).shapes,
      }))
    );
  })
).pipe(Command.withDescription(detail(COMPONENT_LIST_HELP)));

const componentCmd = Command.make("component").pipe(
  Command.withDescription(detail(COMPONENT_HELP)),
  Command.withSubcommands([componentListCmd])
);

export const diagramReadCommands = [listCmd, componentCmd] as const;
