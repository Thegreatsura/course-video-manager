ALTER TABLE "course-video-manager_av_calibration" ADD COLUMN "camera_device" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" ADD COLUMN "claps_found" integer;--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" ADD COLUMN "clap_spread_ms" double precision;--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" ADD COLUMN "mic_offset_ms" double precision;--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" ADD COLUMN "camera_file_path" text;