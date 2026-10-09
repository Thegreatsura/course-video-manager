import { Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { ICON_NAMES } from "@cvm/lucide-icons";
import {
  applySimpleDiagram,
  parseSimpleDiagram,
} from "@cvm/core/lib/simple-diagram/index";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import {
  DiagramRenderError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import { renderDiagramInDaemon } from "@/services/clip-mockup-daemon/client";
import { entityDeepLink } from "@/features/entity-links/entity-deep-link";
import { detail, emitNdjson, parseError } from "@/cli/helpers";
import { resolveAppUrl } from "@/cli/env";
import {
  NEEDS_THE_APP_AND_A_BROWSER,
  requireLocalMachine,
} from "@/cli/local-only";
import { CREATE_HELP, HELP } from "./diagram.help";

/**
 * `cvm diagram`: an agent drafts a Diagram in the simple shape format
 * (`@cvm/core/lib/simple-diagram`) and Matt finishes it in the playground.
 *
 * `create` checks the file, DRAWS it, and only then writes the row — so the
 * one failure an agent cannot fix in its JSON (the app is not running) leaves
 * nothing behind, and running it again never makes a second Diagram.
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
      const parsed = parseSimpleDiagram(json, ICONS);
      if (!parsed.ok) {
        return yield* parseError(
          `the Diagram has ${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
          ENTITY
        );
      }
      const applied = applySimpleDiagram(null, parsed.diagram);
      if (!applied.ok) {
        return yield* parseError(applied.errors.join("\n"), ENTITY);
      }

      const fs = yield* FileSystem.FileSystem;
      const renderFailed = (cause: unknown) =>
        new DiagramRenderError({
          cause,
          message: `could not prepare ${RENDER_DIR} for the PNG`,
        });
      yield* fs
        .makeDirectory(RENDER_DIR, { recursive: true })
        .pipe(Effect.mapError(renderFailed));
      const drawn = nodePath.join(RENDER_DIR, `draft-${randomUUID()}.png`);
      const appUrl = resolveAppUrl();
      yield* renderScene({ appUrl, scene: applied.scene, outputPath: drawn });

      const diagrams = yield* DiagramOperationsService;
      const diagram = yield* diagrams.createDiagram({
        name: parsed.diagram.name,
        headScene: applied.scene,
      });

      const image = nodePath.join(RENDER_DIR, `${diagram.id}.png`);
      yield* fs.rename(drawn, image).pipe(Effect.mapError(renderFailed));

      yield* emitNdjson([
        {
          id: diagram.id,
          url: entityDeepLink({ type: "diagram", id: diagram.id }, appUrl),
          image,
        },
      ]);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

export const diagramCommand = Command.make("diagram").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([createCmd])
);
