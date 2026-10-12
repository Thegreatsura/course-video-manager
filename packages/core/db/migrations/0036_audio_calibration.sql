CREATE TABLE "course-video-manager_audio_calibration" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"outcome" text NOT NULL,
	"noise_floor_db" double precision NOT NULL,
	"speech_lufs" double precision NOT NULL,
	"threshold_db" double precision NOT NULL,
	"recorder_mic" text NOT NULL,
	"browser_input_label" text,
	"script_version" integer NOT NULL,
	"mic_file_path" text NOT NULL,
	"browser_trace_path" text NOT NULL,
	CONSTRAINT "audio_calibration_outcome_valid" CHECK ("course-video-manager_audio_calibration"."outcome" IN ('passed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "audio_calibration_created_at_idx" ON "course-video-manager_audio_calibration" USING btree ("created_at");