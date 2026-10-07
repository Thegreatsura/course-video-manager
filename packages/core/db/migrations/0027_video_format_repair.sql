-- Re-applies 0004_video_format_landscape, which drizzle silently skipped on
-- production: an unmerged branch's 0004_boring_hulk (a LATER `when`) had been
-- applied first, and drizzle only runs migrations newer than the newest one
-- recorded. Idempotent, so it is safe on a database where 0004 did run.
ALTER TABLE "course-video-manager_video" ALTER COLUMN "format" SET DEFAULT 'landscape';--> statement-breakpoint
-- resolveVideoFormat already reads anything that is not 'short' as landscape.
UPDATE "course-video-manager_video" SET "format" = 'landscape' WHERE "format" NOT IN ('landscape', 'short');--> statement-breakpoint
ALTER TABLE "course-video-manager_video" DROP CONSTRAINT IF EXISTS "video_format_valid";--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD CONSTRAINT "video_format_valid" CHECK ("course-video-manager_video"."format" IN ('landscape', 'short'));
