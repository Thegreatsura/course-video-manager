import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { ICON_NAMES } from "@cvm/lucide-icons";
import {
  readSimpleDiagram,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import type { UpdateSnapshotResult } from "@/services/db-diagram-agent-operations.server";
import {
  DiagramRenderError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import { renderDiagramInDaemon } from "@/services/clip-mockup-daemon/client";
import { entityDeepLink } from "@/features/entity-links/entity-deep-link";
import { detail, emitNdjson, parseError } from "@/cli/helpers";
import { entityIdArg } from "@/cli/entity-id";
import { notFound } from "@/cli/errors";
import { resolveAppUrl } from "@/cli/env";
import {
  NEEDS_THE_APP_AND_A_BROWSER,
  requireLocalMachine,
} from "@/cli/local-only";
import {
  CREATE_HELP,
  DELETE_HELP,
  GET_HELP,
  HELP,
  RENDER_HELP,
  RESTORE_HELP,
  SNAPSHOT_ADD_HELP,
  SNAPSHOT_HELP,
  UPDATE_HELP,
} from "./diagram.help";
import { SNAPSHOT_UPDATE_HELP } from "./diagram-snapshot-update.help";
import { parseCreateInput, parseSnapshotInput } from "./diagram-input";
import { diagramReadCommands } from "./diagram-list";

/**
 * `cvm diagram`: an agent drafts a Diagram in the simple shape format
 * (`@cvm/core/lib/simple-diagram`) and Matt finishes it in the playground.
 *
 * A Diagram's drawings are DiagramSnapshots: `create` keeps each one it is
 * given as a Preserved Snapshot and restores the first to the head;
 * `snapshot add` keeps one more and restores it to the head (an unheld head is
 * preserved first); neither writes the head itself. `snapshot update` redraws
 * one snapshot in place — never one a Clip has filmed — and prints the drawing
 * it replaced. All three check the file, DRAW every snapshot, and only then
 * write, in one transaction — so a failure leaves nothing behind, and nothing
 * after the write can fail. `render` draws a
 * snapshot that is already stored, never the head. `get` only reads: the head
 * and the snapshots, in the simple format. `update` renames the Diagram, and
 * `delete` / `restore` archive and un-archive it, through the same
 * `updateDiagram` the playground's rename and delete use: none of the three
 * touches the head or a snapshot.
 */

const ENTITY = "diagram";

/** Every Lucide name an icon may use, from the vendored table. */
const ICONS: ReadonlySet<string> = new Set(ICON_NAMES);

/** Where the PNGs an agent looks at are written. Under the OS temp dir. */
const RENDER_DIR = nodePath.join(os.tmpdir(), "cvm-diagram-renders");

const readDiagramFile = (source: string) =>
  Effect.gen(function* () {
    const shown = source === "-" ? "(stdin)" : `"${source}"`;
    const text = yield* Effect.try({
      try: () => readFileSync(source === "-" ? 0 : source, "utf8"),
      catch: () => parseError(`could not read --file ${shown}`, ENTITY),
    });
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => parseError(`--file ${shown} is not valid JSON`, ENTITY),
    });
  });

/**
 * Draw `scene` to `outputPath`. In the daemon on a real run; through a
 * FrameCaptureService a test provides, so no Chromium launches in the suite.
 */
const renderScene = (params: {
  readonly appUrl: string;
  readonly scene: unknown;
  readonly outputPath: string;
}) =>
  Effect.gen(function* () {
    const provided = yield* Effect.serviceOption(FrameCaptureService);
    yield* Option.match(provided, {
      onSome: (svc) => svc.renderDiagramToPng(params),
      onNone: () => renderDiagramInDaemon(params),
    });
  });

const renderFailed = (cause: unknown) =>
  new DiagramRenderError({
    cause,
    message: `could not prepare ${RENDER_DIR} for the PNG`,
  });

/** `RENDER_DIR`, made if it is missing. */
const renderDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(RENDER_DIR, { recursive: true })
    .pipe(Effect.mapError(renderFailed));
  return fs;
});

/** Draw `scene` to a draft PNG, before the snapshot that will own it exists. */
const drawDraft = (appUrl: string, scene: unknown) =>
  Effect.gen(function* () {
    const outputPath = nodePath.join(RENDER_DIR, `draft-${randomUUID()}.png`);
    yield* renderScene({ appUrl, scene, outputPath });
    return outputPath;
  });

/**
 * Name a draft PNG after the snapshot it shows: `<snapshotId>.png`. It runs
 * after the write has committed, so it never fails: if the rename does, the
 * PNG stays at its draft path and that path is what the agent is given.
 */
const keepDraft = (
  fs: FileSystem.FileSystem,
  draft: string,
  snapshotId: string
) => {
  const image = nodePath.join(RENDER_DIR, `${snapshotId}.png`);
  return fs.rename(draft, image).pipe(
    Effect.as(image),
    Effect.orElseSucceed(() => draft)
  );
};

const problems = (errors: readonly string[], what: string) =>
  parseError(
    `${what} has ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    ENTITY
  );

const createCmd = Command.make(
  "create",
  {
    file: Options.text("file").pipe(
      Options.withDescription(
        'The Diagram as simple-format JSON (see `cvm diagram --help`). "-" reads STDIN.'
      )
    ),
  },
  ({ file }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm diagram", NEEDS_THE_APP_AND_A_BROWSER);

      const json = yield* readDiagramFile(file);
      const input = parseCreateInput(json, ICONS);
      if (!input.ok) return yield* problems(input.errors, "the Diagram");

      const fs = yield* renderDir;
      const appUrl = resolveAppUrl();
      const drafts: string[] = [];
      for (const scene of input.scenes) {
        drafts.push(yield* drawDraft(appUrl, scene));
      }

      const diagrams = yield* DiagramOperationsService;
      const { diagram, snapshots } = yield* diagrams.createDiagramFromSnapshots(
        { name: input.name, scenes: input.scenes }
      );

      const drawn: Array<{ id: string; image: string }> = [];
      for (const [index, snapshot] of snapshots.entries()) {
        const image = yield* keepDraft(fs, drafts[index]!, snapshot.id);
        drawn.push({ id: snapshot.id, image });
      }

      yield* emitNdjson([
        {
          id: diagram.id,
          url: entityDeepLink({ type: "diagram", id: diagram.id }, appUrl),
          snapshots: drawn,
        },
      ]);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

const snapshotAddCmd = Command.make(
  "add",
  {
    diagramId: entityIdArg("diagram", "diagramId"),
    file: Options.text("file").pipe(
      Options.withDescription(
        'The drawing as simple-format JSON, { "shapes": [...] } (see `cvm diagram --help`). "-" reads STDIN.'
      )
    ),
  },
  ({ diagramId, file }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm diagram", NEEDS_THE_APP_AND_A_BROWSER);

      const json = yield* readDiagramFile(file);

      const diagrams = yield* DiagramOperationsService;
      const missing = () => notFound(ENTITY, diagramId);
      const diagram = yield* diagrams
        .getDiagram(diagramId)
        .pipe(Effect.catchTag("NotFoundError", missing));

      // Applied onto the head as read here. Should the head change before the
      // write, addSnapshotToHead still preserves that newer head first.
      const input = parseSnapshotInput(json, ICONS, diagram.headScene);
      if (!input.ok) return yield* problems(input.errors, "the snapshot");

      const fs = yield* renderDir;
      const draft = yield* drawDraft(resolveAppUrl(), input.scene);
      const { snapshot } = yield* diagrams
        .addSnapshotToHead(diagramId, input.scene)
        .pipe(Effect.catchTag("NotFoundError", missing));
      const image = yield* keepDraft(fs, draft, snapshot.id);

      yield* emitNdjson([{ snapshotId: snapshot.id, image }]);
    })
).pipe(Command.withDescription(detail(SNAPSHOT_ADD_HELP)));

/** Why `updateSnapshot` refused, as the exit-3 error an agent reads. */
const refusal = (
  snapshotId: string,
  result: Exclude<UpdateSnapshotResult, { outcome: "updated" | "unchanged" }>
) => {
  switch (result.outcome) {
    case "filmed": {
      const n = result.clipIds.length;
      const shown = result.clipIds.slice(0, 3).join(", ");
      const clips = `${n} Clip${n === 1 ? " pins" : "s pin"} it (${shown}${n > 3 ? `, and ${n - 3} more` : ""})`;
      return parseError(
        `REFUSED: snapshot ${snapshotId} was FILMED — ${clips}, and a filmed snapshot never changes, so going back to a Clip shows what was on camera. Nothing was written. 'cvm diagram snapshot add' the fixed drawing to the Diagram instead.`,
        ENTITY
      );
    }
    case "duplicate":
      return parseError(
        `snapshot ${result.otherSnapshotId}${result.otherArchived ? " (archived)" : ""} already draws exactly this — every snapshot of a Diagram must differ. Nothing was written.`,
        ENTITY
      );
    case "changed-since-read":
      return parseError(
        `snapshot ${snapshotId} changed while this ran. Nothing was written; run it again.`,
        ENTITY
      );
  }
};

const snapshotUpdateCmd = Command.make(
  "update",
  {
    snapshotId: Args.text({ name: "snapshotId" }),
    file: Options.text("file").pipe(
      Options.withDescription(
        'The new drawing as simple-format JSON, { "shapes": [...] }, applied onto the snapshot (see `cvm diagram --help`). "-" reads STDIN.'
      )
    ),
  },
  ({ snapshotId, file }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm diagram", NEEDS_THE_APP_AND_A_BROWSER);

      const json = yield* readDiagramFile(file);

      const diagrams = yield* DiagramOperationsService;
      const missing = () => notFound("diagram snapshot", snapshotId);
      const before = yield* diagrams
        .getDiagramSnapshot(snapshotId)
        .pipe(Effect.catchTag("NotFoundError", missing));

      const input = parseSnapshotInput(json, ICONS, before.scene);
      if (!input.ok) return yield* problems(input.errors, "the snapshot");

      const fs = yield* renderDir;
      const draft = yield* drawDraft(resolveAppUrl(), input.scene);
      const result = yield* diagrams
        .updateSnapshot(snapshotId, input.scene, {
          expectedContentHash: before.contentHash,
        })
        .pipe(Effect.catchTag("NotFoundError", missing));
      if (result.outcome !== "updated" && result.outcome !== "unchanged") {
        yield* fs.remove(draft).pipe(Effect.ignore);
        return yield* refusal(snapshotId, result);
      }
      const image = yield* keepDraft(fs, draft, snapshotId);

      yield* emitNdjson([
        {
          snapshotId,
          image,
          changed: result.outcome === "updated",
          headMoved: result.outcome === "updated" && result.headMoved,
          previous: { shapes: shapesOf(before.scene) },
        },
      ]);
    })
).pipe(Command.withDescription(detail(SNAPSHOT_UPDATE_HELP)));

const snapshotCmd = Command.make("snapshot").pipe(
  Command.withDescription(detail(SNAPSHOT_HELP)),
  Command.withSubcommands([snapshotAddCmd, snapshotUpdateCmd])
);

const renderCmd = Command.make(
  "render",
  { snapshotId: Args.text({ name: "snapshotId" }) },
  ({ snapshotId }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm diagram", NEEDS_THE_APP_AND_A_BROWSER);

      const diagrams = yield* DiagramOperationsService;
      const snapshot = yield* diagrams
        .getDiagramSnapshot(snapshotId)
        .pipe(
          Effect.catchTag("NotFoundError", () =>
            notFound("diagram snapshot", snapshotId)
          )
        );

      yield* renderDir;
      const image = nodePath.join(RENDER_DIR, `${snapshot.id}.png`);
      yield* renderScene({
        appUrl: resolveAppUrl(),
        scene: snapshot.scene,
        outputPath: image,
      });

      yield* emitNdjson([{ snapshotId: snapshot.id, image }]);
    })
).pipe(Command.withDescription(detail(RENDER_HELP)));

/** A stored scene's shapes in the simple format; no scene (a new head) has none. */
const shapesOf = (scene: unknown) => {
  const store = (scene as Partial<Scene> | null)?.store;
  return store && typeof store === "object"
    ? readSimpleDiagram(store).shapes
    : [];
};

const getCmd = Command.make(
  "get",
  {
    diagramId: entityIdArg("diagram", "diagramId"),
    snapshot: Options.text("snapshot").pipe(
      Options.withDescription(
        "Print this one DiagramSnapshot's drawing instead of the head and the list."
      ),
      Options.optional
    ),
  },
  ({ diagramId, snapshot }) =>
    Effect.gen(function* () {
      const diagrams = yield* DiagramOperationsService;
      const diagram = yield* diagrams
        .getDiagram(diagramId)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound(ENTITY, diagramId))
        );

      if (Option.isSome(snapshot)) {
        const missing = () => notFound("diagram snapshot", snapshot.value);
        const one = yield* diagrams
          .getDiagramSnapshot(snapshot.value)
          .pipe(Effect.catchTag("NotFoundError", missing));
        if (one.diagramId !== diagram.id) return yield* missing();
        yield* emitNdjson([
          { snapshotId: one.id, shapes: shapesOf(one.scene) },
        ]);
        return;
      }

      const snapshots = yield* diagrams.listSnapshotsWithClips(diagram.id);
      yield* emitNdjson([
        {
          id: diagram.id,
          name: diagram.name,
          archived: diagram.archived,
          url: entityDeepLink(
            { type: "diagram", id: diagram.id },
            resolveAppUrl()
          ),
          head: { shapes: shapesOf(diagram.headScene) },
          snapshots: snapshots.map((s) => ({
            id: s.id,
            preserved: s.preserved,
            clipIds: s.clips.filter((c) => !c.archived).map((c) => c.id),
            diagramText: s.searchText ?? "",
            createdAt: s.createdAt,
          })),
        },
      ]);
    })
).pipe(Command.withDescription(detail(GET_HELP)));

/**
 * Write `fields` on the Diagram through the playground's own `updateDiagram`
 * (`api.diagrams.$diagramId.update`), and print what an agent needs of it.
 * The head and the snapshots are never part of `fields`.
 */
const writeDiagram = (
  diagramId: string,
  fields: { name?: string; archived?: boolean }
) =>
  Effect.gen(function* () {
    const diagrams = yield* DiagramOperationsService;
    const diagram = yield* diagrams
      .updateDiagram(diagramId, fields)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFound(ENTITY, diagramId))
      );
    yield* emitNdjson([
      {
        id: diagram.id,
        name: diagram.name,
        archived: diagram.archived,
        url: entityDeepLink(
          { type: "diagram", id: diagram.id },
          resolveAppUrl()
        ),
      },
    ]);
  });

const updateCmd = Command.make(
  "update",
  {
    diagramId: entityIdArg("diagram", "diagramId"),
    name: Options.text("name").pipe(
      Options.withDescription("The Diagram's new name.")
    ),
  },
  ({ diagramId, name }) =>
    Effect.gen(function* () {
      // Trimmed and refused when empty, as the playground's rename does.
      const trimmed = name.trim();
      if (!trimmed) return yield* parseError("--name cannot be empty", ENTITY);
      yield* writeDiagram(diagramId, { name: trimmed });
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const deleteCmd = Command.make(
  "delete",
  { diagramId: entityIdArg("diagram", "diagramId") },
  ({ diagramId }) => writeDiagram(diagramId, { archived: true })
).pipe(Command.withDescription(detail(DELETE_HELP)));

const restoreCmd = Command.make(
  "restore",
  { diagramId: entityIdArg("diagram", "diagramId") },
  ({ diagramId }) => writeDiagram(diagramId, { archived: false })
).pipe(Command.withDescription(detail(RESTORE_HELP)));

export const diagramCommand = Command.make("diagram").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([
    createCmd,
    snapshotCmd,
    renderCmd,
    getCmd,
    ...diagramReadCommands,
    updateCmd,
    deleteCmd,
    restoreCmd,
  ])
);
