-- The Audio Calibration became the AV Calibration (#2094). Renames only: every
-- calibration row and every Recording Session's link to one is kept.
ALTER TABLE "course-video-manager_audio_calibration" RENAME TO "course-video-manager_av_calibration";--> statement-breakpoint
ALTER INDEX "audio_calibration_created_at_idx" RENAME TO "av_calibration_created_at_idx";--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" RENAME CONSTRAINT "audio_calibration_outcome_valid" TO "av_calibration_outcome_valid";--> statement-breakpoint
ALTER TABLE "course-video-manager_av_calibration" RENAME CONSTRAINT "course-video-manager_audio_calibration_pkey" TO "course-video-manager_av_calibration_pkey";--> statement-breakpoint
ALTER TABLE "course-video-manager_recording_session" RENAME COLUMN "audio_calibration_id" TO "av_calibration_id";--> statement-breakpoint
ALTER TABLE "course-video-manager_recording_session" RENAME CONSTRAINT "course-video-manager_recording_session_audio_calibration_id_course-video-manager_audio_calibration_id_fk" TO "course-video-manager_recording_session_av_calibration_id_course-video-manager_av_calibration_id_fk";
