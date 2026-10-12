-- The "New recorder" is renamed the CVM recorder (#1993): its stored value
-- `new-recorder` becomes `cvm`. Drop the old CHECK, rewrite the rows, then add
-- the new CHECK. drizzle runs a migration in one transaction and the ALTER holds
-- the table lock until commit, so no row is written between the steps; an old
-- app still running afterwards that writes `new-recorder` is refused, never
-- stored. The new code also reads a stray `new-recorder` as `cvm`.
ALTER TABLE "course-video-manager_video" DROP CONSTRAINT IF EXISTS "video_recorder_valid";--> statement-breakpoint
UPDATE "course-video-manager_video" SET "recorder" = 'cvm' WHERE "recorder" = 'new-recorder';--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD CONSTRAINT "video_recorder_valid" CHECK ("course-video-manager_video"."recorder" IS NULL OR "course-video-manager_video"."recorder" IN ('obs', 'cvm'));
