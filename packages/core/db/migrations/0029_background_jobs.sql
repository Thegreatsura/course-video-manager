CREATE TABLE "course-video-manager_job_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_job" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"lane" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"depends_on" varchar(255),
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer NOT NULL,
	"holder" text,
	"lease_until" timestamp with time zone,
	"progress" jsonb,
	"error" jsonb,
	"subject_type" text,
	"subject_id" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_status_valid" CHECK ("course-video-manager_job"."status" IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled')),
	CONSTRAINT "job_attempts_valid" CHECK ("course-video-manager_job"."attempt" >= 1 AND "course-video-manager_job"."max_attempts" >= 1 AND "course-video-manager_job"."attempt" <= "course-video-manager_job"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_sidecar_lease" (
	"id" text PRIMARY KEY DEFAULT 'sidecar' NOT NULL,
	"holder" text NOT NULL,
	"pid" integer NOT NULL,
	"hostname" text NOT NULL,
	"checkout" text NOT NULL,
	"git_sha" text NOT NULL,
	"socket" text NOT NULL,
	"database" text DEFAULT current_database() NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "sidecar_lease_single_row" CHECK ("course-video-manager_sidecar_lease"."id" = 'sidecar')
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_job_event" ADD CONSTRAINT "course-video-manager_job_event_job_id_course-video-manager_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."course-video-manager_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_job" ADD CONSTRAINT "course-video-manager_job_depends_on_course-video-manager_job_id_fk" FOREIGN KEY ("depends_on") REFERENCES "public"."course-video-manager_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_event_job_id_idx" ON "course-video-manager_job_event" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "job_lane_status_created_idx" ON "course-video-manager_job" USING btree ("lane","status","created_at");--> statement-breakpoint
CREATE INDEX "job_status_lease_idx" ON "course-video-manager_job" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "job_depends_on_idx" ON "course-video-manager_job" USING btree ("depends_on");