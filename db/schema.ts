import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`);
const updatedAt = () => text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  masterRow: integer("master_row").notNull(),
  company: text("company").notNull(),
  postingUrl: text("posting_url"),
  talentUrl: text("talent_url"),
  channel: text("channel").notNull(),
  adapter: text("adapter", { enum: ["greenhouse", "lever", "workday", "ashby", "icims", "phenom", "custom"] }).notNull(),
  verification: text("verification").notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
  resumeUpload: text("resume_upload", { enum: ["available", "job_only", "unknown"] }).notNull(),
  jobAlerts: text("job_alerts", { enum: ["available", "unknown"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  checkedAt: text("checked_at").notNull(),
  lastCrawledAt: text("last_crawled_at"),
  nextCrawlAt: text("next_crawl_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("sources_master_row_unique").on(table.masterRow),
  index("sources_enabled_next_crawl_idx").on(table.enabled, table.nextCrawlAt),
  index("sources_company_idx").on(table.company),
]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  externalId: text("external_id"),
  title: text("title").notNull(),
  company: text("company").notNull(),
  location: text("location"),
  arrangement: text("arrangement", { enum: ["onsite", "hybrid", "remote", "unknown"] }).notNull().default("unknown"),
  employmentType: text("employment_type"),
  summary: text("summary"),
  descriptionHash: text("description_hash"),
  officialUrl: text("official_url").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  publishedAt: text("published_at"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  closedAt: text("closed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("jobs_source_url_unique").on(table.sourceId, table.officialUrl),
  index("jobs_status_first_seen_idx").on(table.status, table.firstSeenAt),
  index("jobs_company_idx").on(table.company),
]);

export const keywords = sqliteTable("keywords", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  includeTerms: text("include_terms", { mode: "json" }).$type<string[]>().notNull(),
  excludeTerms: text("exclude_terms", { mode: "json" }).$type<string[]>().notNull(),
  locations: text("locations", { mode: "json" }).$type<string[]>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  deliveryMode: text("delivery_mode", { enum: ["immediate", "six_hour", "daily_digest"] }).notNull().default("six_hour"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const crawlRuns = sqliteTable("crawl_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  scheduledFor: text("scheduled_for").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "blocked"] }).notNull(),
  responseStatus: integer("response_status"),
  jobsSeen: integer("jobs_seen").notNull().default(0),
  jobsCreated: integer("jobs_created").notNull().default(0),
  jobsUpdated: integer("jobs_updated").notNull().default(0),
  jobsClosed: integer("jobs_closed").notNull().default(0),
  contentHash: text("content_hash"),
  error: text("error"),
  createdAt: createdAt(),
}, (table) => [
  index("crawl_runs_source_scheduled_idx").on(table.sourceId, table.scheduledFor),
  index("crawl_runs_status_scheduled_idx").on(table.status, table.scheduledFor),
]);

export const jobMatches = sqliteTable("job_matches", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  keywordId: text("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  matchedTerms: text("matched_terms", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: createdAt(),
  notifiedAt: text("notified_at"),
}, (table) => [
  uniqueIndex("job_matches_job_keyword_unique").on(table.jobId, table.keywordId),
  index("job_matches_keyword_created_idx").on(table.keywordId, table.createdAt),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  keywordId: text("keyword_id").references(() => keywords.id, { onDelete: "set null" }),
  channel: text("channel", { enum: ["email", "webhook"] }).notNull(),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed"] }).notNull(),
  jobCount: integer("job_count").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  error: text("error"),
  createdAt: createdAt(),
}, (table) => [
  index("notifications_status_scheduled_idx").on(table.status, table.scheduledAt),
]);

export const talentTargets = sqliteTable("talent_targets", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  officialUrl: text("official_url").notNull(),
  resumeUpload: text("resume_upload", { enum: ["available", "job_only", "unknown"] }).notNull(),
  jobAlerts: text("job_alerts", { enum: ["available", "unknown"] }).notNull(),
  registrationState: text("registration_state", { enum: ["not_started", "external"] }).notNull().default("not_started"),
  checkedAt: text("checked_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("talent_targets_source_unique").on(table.sourceId),
]);

export const registrationRuns = sqliteTable("registration_runs", {
  id: text("id").primaryKey(),
  talentTargetId: text("talent_target_id").notNull().references(() => talentTargets.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["opened_external", "completed_external", "abandoned"] }).notNull(),
  openedAt: text("opened_at").notNull(),
  completedAt: text("completed_at"),
  notes: text("notes"),
}, (table) => [
  index("registration_runs_target_opened_idx").on(table.talentTargetId, table.openedAt),
]);
