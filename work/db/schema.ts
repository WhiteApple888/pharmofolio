import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  personId: integer("person_id").primaryKey(),
  name: text("name").notNull(),
  grade: text("grade").notNull(),
  track: text("track").notNull(),
  section: text("section").notNull(),
  reportingOfficer: text("reporting_officer"),
  // Canonical source field from pharmacist_profile: Years in Job Grade.
  // Keep years_in_grade during the database transition so existing records stay readable.
  yearsInJobGrade: real("years_in_job_grade"),
  yearsInGrade: real("years_in_grade"),
  sourceRow: integer("source_row").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => profiles.personId),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull(),
  teamView: integer("team_view", { mode: "boolean" }).notNull().default(false),
  divisionView: integer("division_view", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, table => [uniqueIndex("users_username_uq").on(table.username), uniqueIndex("users_person_uq").on(table.personId)]);

export const reportingLines = sqliteTable("reporting_lines", {
  reporteePersonId: integer("reportee_person_id").primaryKey().references(() => profiles.personId),
  supervisorPersonId: integer("supervisor_person_id").notNull().references(() => profiles.personId),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const assessmentRecords = sqliteTable("assessment_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  workflowId: text("workflow_id").notNull(),
  aiResultJson: text("ai_result_json").notNull(),
  status: text("status").notNull().default("draft"),
  submittedAt: integer("submitted_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [uniqueIndex("assessment_workflow_uq").on(table.workflowId)]);

export const assessmentOfficerSubmissions = sqliteTable("assessment_officer_submissions", {
  assessmentId: text("assessment_id").primaryKey().references(() => assessmentRecords.id),
  status: text("status", { enum: ["draft", "submitted"] }).notNull(),
  submittedAt: integer("submitted_at"),
});

export const assessmentItems = sqliteTable("assessment_items", {
  id: text("id").primaryKey(),
  assessmentId: text("assessment_id").notNull().references(() => assessmentRecords.id),
  itemKey: text("item_key").notNull(),
  standardId: text("standard_id").notNull(),
  ownerConfidenceScore: real("owner_confidence_score"),
  ownerJustification: text("owner_justification"),
  ownerSavedAt: integer("owner_saved_at"),
  reviewerUserId: text("reviewer_user_id").references(() => users.id),
  officerConfidenceScore: real("officer_confidence_score"),
  officerJustification: text("officer_justification"),
  officerSavedAt: integer("officer_saved_at"),
}, table => [uniqueIndex("assessment_item_key_uq").on(table.assessmentId, table.itemKey)]);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  context: text("context").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const savedContent = sqliteTable("saved_content", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  context: text("context").notNull(),
  contentType: text("content_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const coachingMessages = sqliteTable("coaching_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  authorRole: text("author_role").notNull(),
  messageType: text("message_type").notNull().default("chat"),
  content: text("content").notNull(),
  generated: integer("generated", { mode: "boolean" }).notNull().default(false),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const developmentPlanResponses = sqliteTable("development_plan_responses", {
  reporteeUserId: text("reportee_user_id").primaryKey().references(() => users.id),
  reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id),
  actionItemsJson: text("action_items_json").notNull().default("[]"),
  discussionNotes: text("discussion_notes").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
