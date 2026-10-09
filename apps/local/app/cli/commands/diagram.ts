import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { ICON_NAMES } from "@cvm/lucide-icons";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
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
  HELP,
  RENDER_HELP,
  SNAPSHOT_ADD_HELP,
  SNAPSHOT_HELP,
} from "./diagram.help";
import { parseCreateInput, parseSnapshotInput } from "./diagram-input";

/**
 * `cvm diagram`: an agent drafts a Diagram in the simple shape format
 * (`@cvm/core/lib/simple-diagram`) and Matt finishes it in the playground.
 *
 * A Diagram's drawings are immutable DiagramSnapshots: `create` keeps each
 * one it is given as a Preserved Snapshot and restores the first to the head;
 * `snapshot add` keeps one more and restores it to the head (an unheld head is
 * preserved first); neither writes the head itself. Both check the file, DRAW
 * every snapshot, and only then write — so the one failure an agent cannot fix
 * in its JSON (the app is not running) leaves nothing behind. `render` draws a
 * snapshot that is already stored, never the head.
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

/** Name a draft PNG after the snapshot it shows: `<snapshotId>.png`. */
const keepDraft = (
  fs: FileSystem.FileSystem,
  draft: string,
  snapshotId: string
) =>
  Effect.gen(function* () {
    const image = nodePath.join(RENDER_DIR, `${snapshotId}.png`);
    yield* fs.rename(draft, image).pipe(Effect.mapError(renderFailed));
    return image;
  });

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
      const input = parseSnapshotInput(json, ICONS);
      if (!input.ok) return yield* problems(input.errors, "the snapshot");

      const diagrams = yield* DiagramOperationsService;
      const missing = () => notFound(ENTITY, diagramId);
      yield* diagrams
        .getDiagram(diagramId)
        .pipe(Effect.catchTag("NotFoundError", missing));

      const fs = yield* renderDir;
      const draft = yield* drawDraft(resolveAppUrl(), input.scene);
      const { snapshot } = yield* diagrams
        .addSnapshotToHead(diagramId, input.scene)
        .pipe(Effect.catchTag("NotFoundError", missing));
      const image = yield* keepDraft(fs, draft, snapshot.id);

      yield* emitNdjson([{ snapshotId: snapshot.id, image }]);
    })
).pipe(Command.withDescription(detail(SNAPSHOT_ADD_HELP)));

const snapshotCmd = Command.make("snapshot").pipe(
  Command.withDescription(detail(SNAPSHOT_HELP)),
  Command.withSubcommands([snapshotAddCmd])
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

export const diagramCommand = Command.make("diagram").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([createCmd, snapshotCmd, renderCmd])
);
