import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { locateClipMockupFile } from "./clip-mockup-files";
import { speechOnsetSeconds } from "./clip-mockup-speech-service";

/**
 * How much of a WAV is read to find where its speech begins: about 1.4 s of
 * 24 kHz mono, four times Kokoro's padding. A line whose speech starts later
 * than that plays from the top.
 */
const HEAD_BYTES = 64 * 1024;

/**
 * Onsets already measured, by the Video's `lineageId` and the WAV's relative
 * path. A speech file is named by a hash of its line, voice and model, so its
 * bytes never change under the same name — which is what lets a cache HIT
 * touch no disk at all, not even a stat (#2337): the Animatic's loader asks
 * for every Clip Mockup on every poll, and on a drvfs Storage Root a stat per
 * WAV per poll was most of the page's load time.
 *
 * The one file that IS rewritten in place is a WAV that could not be read,
 * which is re-synthesised over. Such a file has no onset, so a `0` is never
 * cached: it is measured again next time, and the new bytes are what count.
 */
const onsets = new Map<string, number>();

/**
 * Where the speech in a Clip Mockup's WAV begins, in seconds — see
 * `speechOnsetSeconds`. Read once per file for the life of the server, and
 * only the head of it. `0` for a file it cannot read: the loader already
 * reports a missing WAV as missing.
 */
export const clipMockupSpeechOnsetSeconds = (
  lineageId: string,
  relativePath: string
) =>
  Effect.gen(function* () {
    const key = `${lineageId}\n${relativePath}`;
    const known = onsets.get(key);
    if (known !== undefined) return known;

    const fs = yield* FileSystem.FileSystem;
    const full = yield* locateClipMockupFile(lineageId, relativePath);
    const head = yield* Effect.scoped(
      Effect.flatMap(fs.open(full), (file) => file.readAlloc(HEAD_BYTES))
    );
    const onset = Option.match(head, {
      onNone: () => 0,
      onSome: speechOnsetSeconds,
    });
    if (onset > 0) onsets.set(key, onset);
    return onset;
  }).pipe(Effect.orElseSucceed(() => 0));
