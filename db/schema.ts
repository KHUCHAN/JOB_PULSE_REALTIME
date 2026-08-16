import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`);
const updatedAt = () => text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  masterRow: integer("master_row").notNull(),
  company: text("company").notNull(),
  postingUrl: text("posting_url"),
  talentUrl: text("talent_url"),
  channel: text("channel").notNull(),
  adapter: text("adapter", { enum: ["greenhouse", "lever", "workday", "ashby", "icims", "phenom", "dayforce", "smartrecruiters", "custom"] }).notNull(),
  verification: text("verification").notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
  resumeUpload: text("resume_upload", { enum: ["available", "job_only", "unknown"] }).notNull(),
  jobAlerts: text("job_alerts", { enum: ["available", "unknown"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  checkedAt: text("checked_at").notNull(),
  lastCrawledAt: text("last_crawled_at"),
  nextCrawlAt: text("next_crawl_at"),
  alertBaselineAt: text("alert_baseline_at"),
  facetSyncGeneration: text("facet_sync_generation"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("sources_master_row_unique").on(table.masterRow),
  index("sources_enabled_next_crawl_idx").on(table.enabled, table.nextCrawlAt),
  index("sources_company_idx").on(table.company),
]);

export const catalogState = sqliteTable("catalog_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

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
  description: text("description"),
  responsibilities: text("responsibilities"),
  qualifications: text("qualifications"),
  skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  department: text("department"),
  team: text("team"),
  businessUnit: text("business_unit"),
  jobFamily: text("job_family"),
  jobFunction: text("job_function"),
  industry: text("industry"),
  office: text("office"),
  secondaryLocations: text("secondary_locations", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  locationCity: text("location_city"),
  locationState: text("location_state"),
  locationCountry: text("location_country"),
  locationRegion: text("location_region", { enum: ["us", "non_us", "mixed", "unknown"] }),
  locationPostalCode: text("location_postal_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  salaryMin: real("salary_min"),
  salaryMax: real("salary_max"),
  salaryCurrency: text("salary_currency"),
  salaryInterval: text("salary_interval"),
  benefits: text("benefits"),
  educationRequirements: text("education_requirements"),
  experienceRequirements: text("experience_requirements"),
  experienceLevel: text("experience_level"),
  shiftSchedule: text("shift_schedule"),
  travelRequirements: text("travel_requirements"),
  securityClearance: text("security_clearance"),
  languages: text("languages", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  requisitionId: text("requisition_id"),
  requisitionIdentityKey: text("requisition_identity_key"),
  externalIdentityKey: text("external_identity_key"),
  urlIdentityKey: text("url_identity_key"),
  applyUrl: text("apply_url"),
  sourcePostedText: text("source_posted_text"),
  sourceUpdatedAt: text("source_updated_at"),
  validThrough: text("valid_through"),
  rawPayload: text("raw_payload", { mode: "json" }).$type<Record<string, unknown>>(),
  descriptionHash: text("description_hash"),
  officialUrl: text("official_url").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  openGeneration: integer("open_generation").notNull().default(1),
  reopenedAt: text("reopened_at"),
  alertDiscoveredAfterBaseline: integer("alert_discovered_after_baseline", { mode: "boolean" }).notNull().default(false),
  resumeMatchHash: text("resume_match_hash"),
  reviewState: text("review_state", { enum: ["new", "saved", "hidden", "applied"] }).notNull().default("new"),
  publishedAt: text("published_at"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  closedAt: text("closed_at"),
  topicClassifiedAt: text("topic_classified_at"),
  areaClassifiedAt: text("area_classified_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("jobs_source_url_unique").on(table.sourceId, table.officialUrl),
  index("jobs_status_first_seen_idx").on(table.status, table.firstSeenAt),
  index("jobs_status_topic_classified_id_idx").on(table.status, table.topicClassifiedAt, table.id),
  index("jobs_company_idx").on(table.company),
  index("jobs_status_company_idx").on(table.status, table.company),
  index("jobs_status_arrangement_idx").on(table.status, table.arrangement),
  index("jobs_status_employment_type_idx").on(table.status, table.employmentType),
  index("jobs_status_published_at_idx").on(table.status, table.publishedAt),
  index("jobs_status_location_region_seen_idx").on(table.status, table.locationRegion, table.firstSeenAt),
  index("jobs_location_country_state_city_idx").on(table.locationCountry, table.locationState, table.locationCity),
  index("jobs_experience_level_idx").on(table.experienceLevel),
  index("jobs_salary_currency_min_max_idx").on(table.salaryCurrency, table.salaryMin, table.salaryMax),
  index("jobs_status_url_seen_company_id_idx").on(
    table.status,
    table.officialUrl,
    table.firstSeenAt,
    table.company,
    table.id,
  ),
  index("jobs_status_company_nocase_idx").on(table.status, sql`${table.company} COLLATE NOCASE`),
  index("jobs_status_employment_type_nocase_idx").on(table.status, sql`${table.employmentType} COLLATE NOCASE`),
  index("jobs_location_country_state_city_nocase_idx").on(
    sql`${table.locationCountry} COLLATE NOCASE`,
    sql`${table.locationState} COLLATE NOCASE`,
    sql`${table.locationCity} COLLATE NOCASE`,
  ),
  index("jobs_experience_level_nocase_idx").on(sql`${table.experienceLevel} COLLATE NOCASE`),
  index("jobs_salary_currency_min_max_nocase_idx").on(
    sql`${table.salaryCurrency} COLLATE NOCASE`,
    table.salaryMin,
    table.salaryMax,
  ),
]);

export const jobTopics = sqliteTable("job_topics", {
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  topicKey: text("topic_key").notNull(),
  score: integer("score").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  classifiedAt: text("classified_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.jobId, table.topicKey] }),
  index("job_topics_topic_job_idx").on(table.topicKey, table.jobId),
]);

export const sourceFacets = sqliteTable("source_facets", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  facetKey: text("facet_key").notNull(),
  facetLabel: text("facet_label").notNull(),
  valueKey: text("value_key").notNull(),
  valueLabel: text("value_label").notNull(),
  jobCount: integer("job_count"),
  observedAt: text("observed_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("source_facets_source_key_value_unique").on(table.sourceId, table.facetKey, table.valueKey),
  index("source_facets_source_key_idx").on(table.sourceId, table.facetKey),
]);

export const jobFilterOptionsCache = sqliteTable("job_filter_options_cache", {
  filterKey: text("filter_key").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  valueLabel: text("value_label").notNull(),
  jobCount: integer("job_count").notNull(),
  refreshedAt: text("refreshed_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.filterKey, table.normalizedValue] }),
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

export const matchProfiles = sqliteTable("match_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keywordId: text("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  ruleVersion: text("rule_version").notNull(),
  rulesJson: text("rules_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  minScore: integer("min_score").notNull().default(60),
  activationWatermark: text("activation_watermark"),
  nextDigestAt: text("next_digest_at"),
  evaluationLeaseOwner: text("evaluation_lease_owner"),
  evaluationLeaseExpiresAt: text("evaluation_lease_expires_at"),
  dispatchLeaseOwner: text("dispatch_lease_owner"),
  dispatchLeaseExpiresAt: text("dispatch_lease_expires_at"),
  gmailState: text("gmail_state", { enum: ["unconfigured", "connected", "blocked"] }).notNull().default("unconfigured"),
  lastDigestAt: text("last_digest_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("match_profiles_keyword_unique").on(table.keywordId),
  index("match_profiles_enabled_digest_idx").on(table.enabled, table.nextDigestAt),
]);

export const profileRecipients = sqliteTable("profile_recipients", {
  profileId: text("profile_id").notNull().references(() => matchProfiles.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.recipient] }),
]);

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
  openGeneration: integer("open_generation").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  notificationEligible: integer("notification_eligible", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  notifiedAt: text("notified_at"),
}, (table) => [
  uniqueIndex("job_matches_job_keyword_generation_unique").on(table.jobId, table.keywordId, table.openGeneration),
  index("job_matches_keyword_created_idx").on(table.keywordId, table.createdAt),
  index("job_matches_keyword_active_score_idx").on(table.keywordId, table.isActive, table.score),
]);

export const codexReviews = sqliteTable("codex_reviews", {
  id: text("id").primaryKey(),
  jobMatchId: text("job_match_id").notNull().references(() => jobMatches.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull().references(() => matchProfiles.id, { onDelete: "cascade" }),
  decision: text("decision", { enum: ["approve", "reject"] }).notNull(),
  rationale: text("rationale").notNull(),
  verifiedUrl: text("verified_url").notNull(),
  sourceFile: text("source_file"),
  reviewer: text("reviewer").notNull().default("codex"),
  reviewedAt: text("reviewed_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("codex_reviews_job_match_unique").on(table.jobMatchId),
  index("codex_reviews_profile_decision_idx").on(table.profileId, table.decision, table.reviewedAt),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  keywordId: text("keyword_id").references(() => keywords.id, { onDelete: "set null" }),
  channel: text("channel", { enum: ["email", "webhook"] }).notNull(),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["queued", "sending", "sent", "retryable", "auth_blocked", "failed"] }).notNull(),
  jobCount: integer("job_count").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  error: text("error"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: text("next_retry_at"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  createdAt: createdAt(),
}, (table) => [
  index("notifications_status_scheduled_idx").on(table.status, table.scheduledAt),
  index("notifications_retry_lease_idx").on(table.status, table.nextRetryAt, table.leaseExpiresAt),
]);

export const notificationItems = sqliteTable("notification_items", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  jobMatchId: text("job_match_id").notNull().references(() => jobMatches.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("notification_items_match_recipient_unique").on(table.jobMatchId, table.recipient),
  index("notification_items_notification_idx").on(table.notificationId),
]);

export const notificationIdentityHistory = sqliteTable("notification_identity_history", {
  profileId: text("profile_id").notNull(),
  recipient: text("recipient").notNull(),
  identityKey: text("identity_key").notNull(),
  firstSentAt: text("first_sent_at").notNull(),
  notificationId: text("notification_id"),
  jobMatchId: text("job_match_id"),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.recipient, table.identityKey] }),
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
