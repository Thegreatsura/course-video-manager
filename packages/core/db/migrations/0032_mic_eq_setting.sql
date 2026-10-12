CREATE TABLE "course-video-manager_mic_eq_setting" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"low_db" double precision NOT NULL,
	"mid_db" double precision NOT NULL,
	"high_db" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_recording_session" ADD COLUMN "mic_eq_setting_id" varchar(255) DEFAULT 'default' NOT NULL;