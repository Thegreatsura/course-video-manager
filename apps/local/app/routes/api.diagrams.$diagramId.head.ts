import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import type { Route } from "./+types/api.diagrams.$diagramId.head";
import { data } from "react-router";
import { hashHead } from "@/lib/scene-hash";
import { EXPECTED_HEAD_HASH_HEADER } from "@/features/diagrams/head-autosaver";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.getDiagram(params.diagramId!);
      return data({
        headScene: diagram.headScene,
        headHash: hashHead(diagram.headScene),
        updatedAt: diagram.updatedAt.toISOString(),
      });
    }),
});

const innerAction = makeAction({
  input: "json",
  errors: { NotFoundError: 404, DiagramHeadMovedError: 409 },
  effect: ({ params, payload, request }) =>
    Effect.gen(function* () {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      const diagramOps = yield* DiagramOperationsService;
      const expected = request.headers.get(EXPECTED_HEAD_HASH_HEADER);
      const diagram = yield* diagramOps.updateDiagramHead(
        params.diagramId!,
        payload,
        expected === null
          ? {}
          : { expectedHash: expected === "none" ? null : expected }
      );
      return data({
        ok: true,
        headHash: hashHead(diagram.headScene),
        updatedAt: diagram.updatedAt.toISOString(),
      });
    }),
});

export const action = async (args: Route.ActionArgs) => {
  if (args.request.method !== "PATCH") {
    throw data("Method not allowed", { status: 405 });
  }
  return innerAction(args);
};
