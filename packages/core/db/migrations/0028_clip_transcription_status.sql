-- Every Clip gets an explicit Transcription status. Additive: old code ignores
-- the column, and the default keeps its inserts valid.
ALTER TABLE "course-video-manager_clip" ADD COLUMN "transcription_status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
-- Backfill. The default already made every row 'done', which is right for a
-- Clip with a transcribed_at (a Transcription landed) and for one with text but
-- no transcribed_at (cut from Footage, or older than transcribed_at). A Clip
-- with neither never got a Transcription, and nothing is running to give it
-- one, so it is 'failed': the editor offers a retry instead of "Transcribing"
-- forever. Nothing is backfilled to 'queued' or 'transcribing'.
UPDATE "course-video-manager_clip" SET "transcription_status" = 'failed' WHERE "transcribed_at" IS NULL AND "text" = '';--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD CONSTRAINT "clip_transcription_status_valid" CHECK ("course-video-manager_clip"."transcription_status" IN ('queued', 'transcribing', 'failed', 'done'));
