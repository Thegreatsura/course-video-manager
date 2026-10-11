CREATE TABLE "course-video-manager_recording_session_scene_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"recording_session_id" varchar(255) NOT NULL,
	"file_time" double precision NOT NULL,
	"scene" varchar(255) NOT NULL,
	CONSTRAINT "recording_session_scene_event_scene_valid" CHECK ("course-video-manager_recording_session_scene_event"."scene" IN ('Camera', 'Code', 'No Face'))
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_recording_session" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255),
	"camera_file_path" text NOT NULL,
	"screen_file_path" text NOT NULL,
	"mic_file_path" text NOT NULL,
	"mic_offset_ms" integer DEFAULT 150 NOT NULL,
	"status" text DEFAULT 'recording' NOT NULL,
	"started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"silence_length" text DEFAULT 'short' NOT NULL,
	"camera_frames_lost" integer DEFAULT 0 NOT NULL,
	"screen_frames_lost" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recording_session_status_valid" CHECK ("course-video-manager_recording_session"."status" IN ('recording', 'stopped', 'crashed')),
	CONSTRAINT "recording_session_silence_length_valid" CHECK ("course-video-manager_recording_session"."silence_length" IN ('short', 'long'))
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD COLUMN "recording_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD COLUMN "scene_override" varchar(255);--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD COLUMN "recorder" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_recording_session_scene_event" ADD CONSTRAINT "course-video-manager_recording_session_scene_event_recording_session_id_course-video-manager_recording_session_id_fk" FOREIGN KEY ("recording_session_id") REFERENCES "public"."course-video-manager_recording_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_recording_session" ADD CONSTRAINT "course-video-manager_recording_session_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_session_scene_event_session_time_idx" ON "course-video-manager_recording_session_scene_event" USING btree ("recording_session_id","file_time");--> statement-breakpoint
CREATE INDEX "recording_session_video_id_idx" ON "course-video-manager_recording_session" USING btree ("video_id");--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD CONSTRAINT "course-video-manager_clip_recording_session_id_course-video-manager_recording_session_id_fk" FOREIGN KEY ("recording_session_id") REFERENCES "public"."course-video-manager_recording_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_recording_session_id_idx" ON "course-video-manager_clip" USING btree ("recording_session_id");--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD CONSTRAINT "clip_scene_override_valid" CHECK ("course-video-manager_clip"."scene_override" IS NULL OR "course-video-manager_clip"."scene_override" IN ('Camera', 'Code', 'No Face'));--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD CONSTRAINT "video_recorder_valid" CHECK ("course-video-manager_video"."recorder" IS NULL OR "course-video-manager_video"."recorder" IN ('obs', 'new-recorder'));