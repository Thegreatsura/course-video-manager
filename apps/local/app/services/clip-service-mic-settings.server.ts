import { clips, micEqSettings, recordingSessions } from "@/db/schema";
import {
  MIC_EQ_SETTING_ID,
  type MicEq,
} from "@cvm/core/features/videos/recorder";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Database } from "@/services/drizzle-service.server";
import {
  type LoggerAdapter,
  dbCall,
  touchVideoUpdatedAt,
} from "./clip-service-handler.helpers";

export const OBS_CLIP_MIC_OFFSET_MESSAGE =
  "An OBS Clip has no mic offset: its sound is baked into its Footage.";

/**
 * Set the mic offset of the Recording Session a New-recorder Clip was cut
 * from. Clip times are in the picture's clock, so no Clip moves: the export
 * reads the mic from (start − offset) instead. Raw Footage is untouched; the
 * offset joins the Export Hash, so every Video cut from the Session needs a
 * new export.
 */
export const updateMicOffset = (
  db: Database,
  logger: LoggerAdapter,
  event: { clipId: string; micOffsetMs: number }
) =>
  Effect.gen(function* () {
    const clip = yield* dbCall(() =>
      db.query.clips.findFirst({ where: eq(clips.id, event.clipId) })
    );
    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }
    if (!clip.recordingSessionId) {
      throw new Error(OBS_CLIP_MIC_OFFSET_MESSAGE);
    }

    yield* dbCall(() =>
      db
        .update(recordingSessions)
        .set({ micOffsetMs: event.micOffsetMs })
        .where(eq(recordingSessions.id, clip.recordingSessionId!))
    );

    yield* touchVideoUpdatedAt(db, clip.videoId);
    logger.log(clip.videoId, {
      type: "mic-offset-updated",
      recordingSessionId: clip.recordingSessionId,
      micOffsetMs: event.micOffsetMs,
    });
  });

/**
 * Save the mic EQ every Recording Session is exported with (the one Mic EQ
 * Setting, MIC_EQ_SETTING_ID). It joins every New-recorder Clip's Export
 * Hash, so every New-recorder Video needs a new export; OBS Videos are
 * untouched. Raw Footage is never changed.
 */
export const updateMicEq = (db: Database, event: { micEq: MicEq }) =>
  dbCall(() =>
    db
      .insert(micEqSettings)
      .values({ id: MIC_EQ_SETTING_ID, ...event.micEq })
      .onConflictDoUpdate({
        target: micEqSettings.id,
        set: { ...event.micEq },
      })
  ).pipe(Effect.asVoid);
