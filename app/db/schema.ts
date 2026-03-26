import type { DatabaseId } from "@/features/video-editor/clip-state-reducer";
import { relations, sql, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgTableCreator,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const varcharCollateC = customType<{
  data: string;
  notNull: boolean;
  default: boolean;
}>({
  dataType() {
    return 'varchar(255) COLLATE "C"';
  },
});

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator(
  (name) => `course-video-manager_${name}`
);

export const courses = createTable("course", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  filePath: text("repo_path"),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
  memory: text("memory").notNull().default(""),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const courseVersions = createTable("course_version", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repoId: varchar("course_id", { length: 255 })
    .references(() => courses.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sections = createTable("section", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repoVersionId: varchar("course_version_id", { length: 255 })
    .references(() => courseVersions.id, { onDelete: "cascade" })
    .notNull(),
  previousVersionSectionId: varchar("previous_version_section_id", {
    length: 255,
  }),
  path: text("path").notNull(),
  description: text("description").notNull().default(""),
  archivedAt: timestamp("archived_at", {
    mode: "date",
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  order: doublePrecision("order").notNull(),
});

export const lessons = createTable("lesson", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sectionId: varchar("section_id", { length: 255 })
    .references(() => sections.id, { onDelete: "cascade" })
    .notNull(),
  previousVersionLessonId: varchar("previous_version_lesson_id", {
    length: 255,
  }),
  path: text("path").notNull(),
  title: text("title").notNull().default(""),
  fsStatus: text("fs_status").notNull().default("real"),
  description: text("description").notNull().default(""),
  icon: varchar("icon", { length: 255 }),
  priority: integer("priority").notNull().default(2),
  dependencies: text("dependencies").array(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  order: doublePrecision("order").notNull(),
});

export const videos = createTable("video", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  lessonId: varchar("lesson_id", { length: 255 }).references(() => lessons.id, {
    onDelete: "cascade",
  }),
  path: text("path").notNull(),
  originalFootagePath: text("original_footage_path").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const clips = createTable("clip", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  videoFilename: text("video_filename").notNull(),
  sourceStartTime: doublePrecision("source_start_time").notNull(),
  sourceEndTime: doublePrecision("source_end_time").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  order: varcharCollateC("order").notNull(),
  archived: boolean("archived").notNull().default(false),
  text: text("text").notNull(),
  transcribedAt: timestamp("transcribed_at", {
    mode: "date",
    withTimezone: true,
  }),
  scene: varchar("scene", { length: 255 }),
  profile: varchar("profile", { length: 255 }),
  beatType: varchar("beat_type", { length: 255 }).notNull().default("none"),
});

export const clipSections = createTable("clip_section", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  order: varcharCollateC("order").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export namespace DB {
  export interface Clip extends Omit<InferSelectModel<typeof clips>, "id"> {
    id: DatabaseId;
  }

  export interface ClipSection extends Omit<
    InferSelectModel<typeof clipSections>,
    "id"
  > {
    id: DatabaseId;
  }
}

export const clipsRelations = relations(clips, ({ one }) => ({
  video: one(videos, { fields: [clips.videoId], references: [videos.id] }),
}));

export const clipSectionsRelations = relations(clipSections, ({ one }) => ({
  video: one(videos, {
    fields: [clipSections.videoId],
    references: [videos.id],
  }),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  lesson: one(lessons, { fields: [videos.lessonId], references: [lessons.id] }),
  clips: many(clips),
  clipSections: many(clipSections),
  thumbnails: many(thumbnails),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  section: one(sections, {
    fields: [lessons.sectionId],
    references: [sections.id],
  }),
  videos: many(videos),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  repoVersion: one(courseVersions, {
    fields: [sections.repoVersionId],
    references: [courseVersions.id],
  }),
  lessons: many(lessons),
}));

export const courseVersionsRelations = relations(
  courseVersions,
  ({ one, many }) => ({
    repo: one(courses, {
      fields: [courseVersions.repoId],
      references: [courses.id],
    }),
    sections: many(sections),
  })
);

export const coursesRelations = relations(courses, ({ many }) => ({
  versions: many(courseVersions),
}));

// Plan tables (standalone, not tied to courses)
export const plans = createTable("plan", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  archived: boolean("archived").notNull().default(false),
});

export const planSections = createTable("plan_section", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  planId: varchar("plan_id", { length: 255 })
    .references(() => plans.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  order: doublePrecision("order").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const planLessons = createTable("plan_lesson", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sectionId: varchar("section_id", { length: 255 })
    .references(() => planSections.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  icon: varchar("icon", { length: 255 }),
  status: text("status").notNull().default("todo"),
  priority: integer("priority").notNull().default(2),
  dependencies: text("dependencies").array(),
  order: doublePrecision("order").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const plansRelations = relations(plans, ({ many }) => ({
  sections: many(planSections),
}));

export const planSectionsRelations = relations(
  planSections,
  ({ one, many }) => ({
    plan: one(plans, {
      fields: [planSections.planId],
      references: [plans.id],
    }),
    lessons: many(planLessons),
  })
);

export const planLessonsRelations = relations(planLessons, ({ one }) => ({
  section: one(planSections, {
    fields: [planLessons.sectionId],
    references: [planSections.id],
  }),
}));

// YouTube OAuth tokens table (single-user, stores one token set)
export const youtubeAuth = createTable("youtube_auth", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", {
    mode: "date",
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// AI Hero OAuth tokens table (single-user, stores one token set)
export const aiHeroAuth = createTable("ai_hero_auth", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accessToken: text("access_token").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Global links table for article writing
export const links = createTable("link", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Thumbnails table for layered thumbnail compositing
export const thumbnails = createTable("thumbnail", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  layers: jsonb("layers").notNull(),
  filePath: text("file_path"),
  selectedForUpload: boolean("selected_for_upload").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const thumbnailsRelations = relations(thumbnails, ({ one }) => ({
  video: one(videos, {
    fields: [thumbnails.videoId],
    references: [videos.id],
  }),
}));

// export const chats = createTable("chat", {
//   id: varchar("id", { length: 255 })
//     .notNull()
//     .primaryKey()
//     .$defaultFn(() => crypto.randomUUID()),
//   userId: varchar("user_id", { length: 255 })
//     .notNull()
//     .references(() => users.id),
//   title: varchar("title", { length: 255 }).notNull(),
//   createdAt: timestamp("created_at", {
//     mode: "date",
//     withTimezone: true,
//   })
//     .notNull()
//     .default(sql`CURRENT_TIMESTAMP`),
//   updatedAt: timestamp("updated_at", {
//     mode: "date",
//     withTimezone: true,
//   })
//     .notNull()
//     .default(sql`CURRENT_TIMESTAMP`),
// });

// export const chatsRelations = relations(chats, ({ one, many }) => ({
//   user: one(users, { fields: [chats.userId], references: [users.id] }),
//   messages: many(messages),
// }));

// export const messages = createTable("message", {
//   id: varchar("id", { length: 255 })
//     .notNull()
//     .primaryKey()
//     .$defaultFn(() => crypto.randomUUID()),
//   chatId: varchar("chat_id", { length: 255 })
//     .notNull()
//     .references(() => chats.id),
//   role: varchar("role", { length: 255 }).notNull(),
//   parts: json("parts").notNull(),
//   annotations: json("annotations"),
//   order: gloat("order").notNull(),
//   createdAt: timestamp("created_at", {
//     mode: "date",
//     withTimezone: true,
//   })
//     .notNull()
//     .default(sql`CURRENT_TIMESTAMP`),
// });

// export const messagesRelations = relations(messages, ({ one }) => ({
//   chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
// }));

// export declare namespace DB {
//   export type User = InferSelectModel<typeof users>;
//   export type NewUser = InferInsertModel<typeof users>;

//   export type Account = InferSelectModel<typeof accounts>;
//   export type NewAccount = InferInsertModel<typeof accounts>;

//   export type Session = InferSelectModel<typeof sessions>;
//   export type NewSession = InferInsertModel<typeof sessions>;

//   export type VerificationToken = InferSelectModel<typeof verificationTokens>;
//   export type NewVerificationToken = InferInsertModel<
//     typeof verificationTokens
//   >;

//   export type Chat = InferSelectModel<typeof chats>;
//   export type NewChat = InferInsertModel<typeof chats>;

//   export type Message = InferSelectModel<typeof messages>;
//   export type NewMessage = InferInsertModel<typeof messages>;
// }
