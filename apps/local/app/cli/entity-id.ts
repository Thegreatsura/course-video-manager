import { Args, HelpDoc, Options, ValidationError } from "@effect/cli";
import { Effect } from "effect";
import {
  resolveEntityId,
  type EntityType,
} from "@/features/entity-links/entity-deep-link";

/**
 * THE one place a `cvm` argument that names an entity is read. Every
 * positional `<id>` and every entity-valued flag (`--video`, `--section`,
 * `--before`, …) is declared through these two builders, so each accepts
 * anything Matt might paste: a bare id, any CVM link (any origin, any Video
 * tab, a Lesson's `#id`), or the legacy `course:…/video:…` string. The value
 * the handler sees is always the bare id.
 *
 * A link for a different entity type is refused at parse time (exit 3) with
 * a message naming both, e.g. "that's a Pitch link, this command wants a
 * Video".
 */
type Expected = EntityType | ReadonlyArray<EntityType>;

const resolve = (input: string, expected: Expected) =>
  Effect.try({
    try: () => resolveEntityId(input, expected),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });

/** A positional argument naming one entity of `expected` type(s). */
export const entityIdArg = (
  expected: Expected,
  name = "id"
): Args.Args<string> =>
  Args.text({ name }).pipe(
    Args.mapEffect((input) =>
      resolve(input, expected).pipe(Effect.mapError((m) => HelpDoc.p(m)))
    )
  );

/** A `--<name>` flag naming one entity of `expected` type(s). */
export const entityIdOption = (
  name: string,
  expected: Expected
): Options.Options<string> =>
  Options.text(name).pipe(
    Options.mapEffect((input) =>
      resolve(input, expected).pipe(
        Effect.mapError((m) =>
          ValidationError.invalidValue(HelpDoc.p(`--${name}: ${m}`))
        )
      )
    )
  );

/**
 * A repeatable `--<name>` flag, each value naming one entity of `expected`
 * type(s). (@effect/cli can only repeat a plain option, so this repeats first
 * and resolves each value after.)
 */
export const entityIdsOption = (
  name: string,
  expected: Expected
): Options.Options<ReadonlyArray<string>> =>
  Options.text(name).pipe(
    Options.repeated,
    Options.mapEffect((inputs) =>
      Effect.forEach(inputs, (input) => resolve(input, expected)).pipe(
        Effect.mapError((m) =>
          ValidationError.invalidValue(HelpDoc.p(`--${name}: ${m}`))
        )
      )
    )
  );
