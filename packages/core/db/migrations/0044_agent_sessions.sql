CREATE TABLE "course-video-manager_agent_session_entry" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"agent_session_id" varchar(255) NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"footage_time" double precision NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"skill" text,
	"via" text,
	"args" text,
	"tool" text,
	"summary" text,
	"result_is_error" boolean,
	CONSTRAINT "agent_session_entry_kind_valid" CHECK ("course-video-manager_agent_session_entry"."kind" IN ('userPrompt', 'assistantText', 'interrupt', 'skillCall', 'toolCall')),
	CONSTRAINT "agent_session_entry_via_valid" CHECK ("course-video-manager_agent_session_entry"."via" IS NULL OR "course-video-manager_agent_session_entry"."via" IN ('toolCall', 'slashCommand'))
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_agent_session" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"source_session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_agent_session_entry" ADD CONSTRAINT "course-video-manager_agent_session_entry_agent_session_id_course-video-manager_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."course-video-manager_agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_agent_session_entry" ADD CONSTRAINT "course-video-manager_agent_session_entry_clip_id_course-video-manager_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."course-video-manager_clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_entry_clip_id_idx" ON "course-video-manager_agent_session_entry" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "agent_session_entry_agent_session_id_idx" ON "course-video-manager_agent_session_entry" USING btree ("agent_session_id");--> statement-breakpoint
CREATE INDEX "agent_session_source_session_id_idx" ON "course-video-manager_agent_session" USING btree ("source_session_id");