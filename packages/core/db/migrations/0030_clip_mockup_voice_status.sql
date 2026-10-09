ALTER TABLE "course-video-manager_clip_mockup" ALTER COLUMN "audio_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup" ALTER COLUMN "duration_seconds" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup" ADD COLUMN "voice_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup" ADD COLUMN "voice_error" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup" ADD CONSTRAINT "clip_mockup_voice_status_valid" CHECK ("course-video-manager_clip_mockup"."voice_status" IN ('pending', 'ready', 'failed'));