CREATE TABLE "course-video-manager_learning_goal" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"section_id" varchar(255) NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order" double precision NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_learning_goal" ADD CONSTRAINT "course-video-manager_learning_goal_section_id_course-video-manager_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course-video-manager_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_goal_section_order_uniq" ON "course-video-manager_learning_goal" USING btree ("section_id","order") WHERE NOT "course-video-manager_learning_goal"."archived";--> statement-breakpoint
CREATE INDEX "learning_goal_section_id_idx" ON "course-video-manager_learning_goal" USING btree ("section_id");