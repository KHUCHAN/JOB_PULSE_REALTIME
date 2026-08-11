# Resume Match and Gmail Alert Design

## Goal

Add a personal resume-based job filter to Job Pulse Realtime and automatically email newly discovered matching United States internship and co-op postings from `kimchany@usc.edu` to:

- `kimchany@usc.edu`
- `lupeter@usc.edu`

The feature must be explainable, deterministic, inexpensive enough to run after every crawl, resistant to duplicate delivery, and safe under concurrent crawl requests.

## Approved product scope

The feature evaluates open U.S. internship and co-op postings against Chanyoung Kim's April 8, 2026 resume. It does not email existing jobs when the feature is activated. Existing matches are backfilled for the website only and marked as baseline records. Email delivery starts with jobs first discovered after the activation watermark, plus jobs that are subsequently confirmed as genuinely reopened.

The match profile targets:

- AI and machine learning;
- data science, data engineering, analytics, quantitative, and business intelligence;
- LLM, NLP, RAG, evaluation, context engineering, knowledge graphs, and agentic AI;
- computer vision and OCR;
- risk, fraud, AML, RegTech, financial crime, and data quality;
- direct software engineering and software developer roles.

The profile uses the resume as its source but stores only normalized matching rules and evidence labels. The source PDF bytes and full extracted resume text are not copied into D1.

## Chosen approach

Use a hybrid deterministic matcher:

1. Apply hard eligibility gates.
2. Normalize title, structured ATS fields, skills, and selected description text.
3. Detect controlled phrase families with boundary-safe regular expressions.
4. Calculate a weighted score from independent resume evidence groups.
5. Store the score and human-readable reasons.

This is preferred to one large regex because it makes false positives and omissions independently testable. It is preferred to per-job embeddings or LLM calls because hundreds of thousands of postings must remain inexpensive, fast, reproducible, and usable without another model API credential.

## Eligibility gates

A job is eligible only when all of the following are true:

- canonical job status is open;
- `location_region = 'us'`;
- the dedicated program classifier contains `internship` or `coop`;
- the posting is not explicitly high-school-only;
- the posting is not explicitly PhD-only;
- the posting does not explicitly require U.S. citizenship, an active security clearance, or eligibility that the resume cannot satisfy.

An explicit 2027 recruiting cycle is a positive signal, not a hard requirement. Many relevant postings omit a recruiting year, so yearless U.S. internships remain eligible. Master's or graduate-student eligibility is a positive signal. A generic `no sponsorship` statement is not itself an exclusion because it does not necessarily exclude curricular practical training; the UI may expose it as cautionary evidence when available.

## Normalization and phrase families

All text is normalized to Unicode-compatible lowercase tokens with punctuation, slash, dash, and spacing variants handled before phrase matching. Regular expressions use word or token boundaries so strings such as `internal audit` do not satisfy `intern`.

Program recognition reuses the existing classifier and covers, at minimum:

- intern, interns, internship, internships;
- co-op, co op, coop, cooperative education;
- student intern, student placement, industrial placement;
- summer analyst or summer associate only when the posting identifies the program as an internship.

Role families include:

- data scientist, applied scientist, research scientist;
- machine learning, artificial intelligence, deep learning, NLP, LLM, RAG;
- data engineer, analytics engineer, BI engineer, data analyst, quantitative analyst or researcher;
- fraud analytics, risk analytics, AML, financial crime, RegTech, compliance analytics;
- software engineer, software developer, application developer, frontend, backend, full-stack, mobile, and explicitly software-focused firmware;
- computer vision, image processing, OCR, and multimodal ML.

Generic HR, marketing, sales, recruiting, communications, accounting, clinical, and nontechnical operations roles do not qualify merely because their descriptions mention data or AI. Generic systems, hardware, electrical, manufacturing, product, program, DevOps, cloud, and cybersecurity roles qualify only when a direct approved role-family signal is also present.

## Scoring model

The initial score is a bounded 0-100 integer:

- up to 35 points for direct role-family evidence;
- up to 30 points for resume skill evidence;
- up to 15 points for domain overlap;
- up to 10 points for degree, graduate-student, and December 2027 eligibility;
- up to 10 points for recruiting-cycle and posting freshness.

Positive skill evidence includes Python, SQL, Pandas, scikit-learn, PySpark, Hadoop, MongoDB, Neo4j, knowledge graphs, Tableau, NLP, LLM evaluation, RAG, OpenCV, model evaluation, data quality, ETL, and crawling.

Domain overlap includes AML, KYC, fraud, risk, financial crime, regulatory technology, compliance, graph analysis, supply-chain analytics, and information extraction.

The initial match threshold is 60. At least one direct role-family signal is required even when skill and domain points are high. The matcher returns stable evidence codes and display labels rather than only a number. Examples include `role:data-science`, `skill:python`, `domain:aml-risk`, and `education:masters-eligible`.

Rule configuration, weights, threshold, and rule version are stored as profile data so future tuning does not require rewriting historical evidence. A rule-version change triggers a bounded website-only reclassification. It does not make old jobs newly email-eligible.

## Data model

### `match_profiles`

Stores the resume profile:

- stable id and display name;
- system keyword id used by the existing `job_matches` table;
- enabled state;
- rule version and JSON rule configuration;
- minimum score;
- U.S.-only and internship/co-op eligibility settings;
- activation watermark;
- next digest time;
- evaluation and dispatch lease fields;
- created and updated timestamps.

There is one active personal profile in the first release.

### `profile_recipients`

Stores one row per normalized recipient email:

- profile id;
- recipient;
- enabled state;
- created and updated timestamps.

The composite primary key is `(profile_id, recipient)`. Recipient matching is case-insensitive.

### Existing `job_matches`

The profile owns one system keyword row, allowing the existing `job_matches` table to store:

- canonical job id;
- system keyword id;
- integer score;
- JSON evidence codes;
- notification-eligibility state;
- match creation time;
- notification metadata.

Add an open-generation field to distinguish a genuine closed-to-open transition. Replace the current uniqueness rule with `(job_id, keyword_id, open_generation)`. Existing records use generation 1.

Notification eligibility is explicit rather than inferred from the match row's creation timestamp. Baseline backfill rows set it to false even though the backfill itself runs after activation. Newly discovered post-watermark matches and genuinely reopened post-watermark generations set it to true. The legacy `notified_at` field remains an aggregate compatibility value; recipient-specific delivery truth comes from `notification_items`.

### Jobs reopen generation

Add `jobs.open_generation`, defaulting to 1. It increments only when a previously closed canonical posting is observed open again. Refreshes of an already-open posting do not increment it.

### Existing `notifications`

One notification row represents one Gmail digest to one recipient. Extend its delivery state to support:

- queued;
- sending;
- sent;
- retryable failure;
- authentication blocked;
- permanently failed.

It records attempt count, next retry time, provider message id, lease owner/expiry, error, and timestamps.

### `notification_items`

Links a notification envelope to individual resume matches and includes the recipient and open generation. A unique constraint on `(job_match_id, recipient)` prevents the same job generation from being emailed twice to the same recipient, even when requests overlap or retry.

Indexes must support:

- active profile lease acquisition;
- open U.S. internship candidate scans;
- notification-eligible unsent match lookup by profile and creation time;
- due notification claim by status and scheduled time;
- recipient-level idempotency checks.

Migration SQL and snapshot metadata remain immutable and are packaged with the Sites deployment.

## Crawl and match data flow

Each successful source sync already knows which canonical job URLs were created, refreshed, closed, or reopened. Extend the persistence result with bounded touched-job identities, or query those identities immediately by source and URL after upsert.

For each touched open job:

1. Resolve canonical job data and structured topics.
2. Apply eligibility gates.
3. Score the job with the active profile rule version.
4. Upsert the generation-specific `job_matches` record when the threshold is met.
5. Remove or mark a current-generation match ineligible when refreshed evidence no longer meets the threshold.

Concurrent `crawlBatch` requests may evaluate separate jobs, but profile-wide backfills and digest creation use atomic D1 leases. A bounded resume-match backfill action processes existing canonical open jobs with a keyset cursor. Before activation, it records the current time as the activation watermark. Backfilled matches earlier than or equal to that watermark are visible on the website but are not eligible for email.

## Digest schedule

The profile uses a two-hour delivery interval aligned to its own `next_digest_at`. Every bounded `crawlBatch` invocation may call the alert processor, but only one invocation can atomically claim a due digest lease.

A due digest contains matches accumulated during the completed prior interval. Matches created during the current crawl interval wait for the next digest. This avoids sending a tiny email after every source while remaining compatible with the existing two-hour production crawl automation.

No email is sent when there are no eligible unsent matches. Each recipient receives an independent message so one recipient's failure does not block the other.

Each message contains at most 25 jobs. Larger sets are split into deterministic parts. Ordering is score descending, then trustworthy posting time descending, then first-seen time descending, then stable job id.

## Gmail API delivery

The sender is `kimchany@usc.edu`. The Gmail API scope is limited to `https://www.googleapis.com/auth/gmail.send`.

One-time setup uses Chrome:

1. Create or select a personal Google Cloud project.
2. Enable the Gmail API.
3. Configure an OAuth consent screen for personal use.
4. Create an OAuth client.
5. Authorize `kimchany@usc.edu` for the send-only scope.
6. Obtain a refresh token.

If USC Workspace policy blocks an unverified OAuth app, setup stops and reports the administrator restriction rather than changing account or security policy.

Secrets are stored only in Sites production secret environment variables:

- `GMAIL_CLIENT_ID`;
- `GMAIL_CLIENT_SECRET`;
- `GMAIL_REFRESH_TOKEN`;
- `GMAIL_SENDER`.

They are never written to Git, D1, logs, browser storage, or generated deployment archives. Recipients are product configuration in D1 and are not treated as OAuth secrets.

The runtime exchanges the refresh token for a short-lived access token, creates a plain-text and HTML multipart MIME message, base64url encodes it, and calls Gmail `users.messages.send` for user `me`. Provider error bodies are bounded and sanitized before storage.

## Email content

Subject:

```text
[Job Pulse] New resume matches: 8
```

The email identifies the interval and includes, for each job:

- company;
- role;
- U.S. location;
- `Posted` date when supplied by the ATS, otherwise `First seen`;
- match score;
- up to four concise match reasons;
- official application URL.

The message includes a private Jobs-page deep link with the `My Resume Match` filter. It does not embed the resume, phone number, or unrelated personal information.

## Failure, retry, and idempotency behavior

Notification creation and item reservation occur in D1 before Gmail is called. Claiming a due notification atomically transitions it to `sending` with a short lease.

- Gmail success stores the provider message id and marks all reserved items delivered.
- Network errors, 429s, and Gmail 5xx responses are retryable with bounded exponential backoff.
- OAuth 401 or `invalid_grant` marks the profile authentication-blocked and stops additional send attempts until reconnection.
- Permanent 4xx request errors store a sanitized reason and require manual retry after correction.
- An expired sending lease returns the notification to the retryable queue.

The recipient-specific unique constraint is the final duplicate-delivery guard. A retry reuses the same notification envelope and items. It never creates a second envelope for already-reserved recipient/job pairs.

## Jobs-page experience

Add a first-class `My Resume Match` preset. It applies:

- active resume profile;
- U.S. region;
- internship or co-op;
- score at or above the profile threshold.

Results default to match score descending and then posting freshness. Existing company, location, date, area, status, and arrangement filters remain combinable.

Desktop and mobile results display:

- match percentage or integer score;
- compact evidence chips;
- existing company, role, region, and posting timing.

The job detail drawer adds a `Why this matches` section with positive evidence, eligibility notes, and any non-excluding cautions. It does not claim immigration eligibility when the posting language is ambiguous.

## Alerts-page experience

Add a `Resume Match Email` card that shows:

- Gmail connection state;
- sender;
- both recipients;
- enabled state;
- last successful digest;
- next scheduled digest;
- queued match count;
- latest sanitized delivery error.

Controls include enable/disable and `Send test email`. The test action sends a clearly labeled connection test without reserving or marking any job match. An authentication-blocked state presents a reconnect action rather than repeatedly retrying.

## API boundaries

Add small server modules with explicit contracts:

- resume job normalization and scoring;
- match persistence and bounded backfill;
- digest planning and recipient idempotency;
- Gmail token exchange and message sending;
- notification lease, retry, and completion.

The pulse API gains read endpoints for the resume profile and delivery status, plus mutations for enable/disable, bounded backfill, test email, and retry/reconnect status. Internal crawl processing calls the same modules directly rather than issuing HTTP requests to itself.

All mutations validate profile ids, normalized recipient addresses, bounded batch sizes, and allowed state transitions.

## Security and privacy

- The private Sites access policy remains unchanged.
- Gmail OAuth uses only the send scope.
- OAuth secrets are production environment secrets.
- Logs and activity events never contain access tokens, refresh tokens, client secrets, full Gmail error payloads, or email message bodies.
- The resume file remains outside the deployed repository.
- Stored rules contain professional skills and matching preferences, not the resume phone number or full document text.
- Official URLs are HTML-escaped in email output and allow only `http` or `https`.

## Testing

### Matcher

Unit tests cover:

- intern, internship, co-op, co op, coop, student placement, and eligible summer-program variants;
- `internal audit` and `international` false-positive prevention;
- approved AI, data, risk, AML, computer-vision, and direct software role families;
- misleading generic AI/data references in HR, marketing, sales, and policy text;
- yearless internships and 2027 positive weighting;
- Master's eligibility, PhD-only and high-school-only exclusion;
- U.S. citizenship and active-clearance exclusion;
- score cap, threshold, evidence stability, and rule-version behavior.

### Persistence and concurrency

Tests cover:

- website-only baseline backfill;
- newly discovered post-watermark email eligibility;
- refresh without duplicate match generation;
- closed-to-open generation increment;
- two concurrent match evaluators;
- two concurrent digest claimers;
- recipient-specific idempotency;
- failed first recipient with successful second recipient;
- expired lease recovery.

### Gmail boundary

The Gmail transport uses dependency injection. Tests use a contract-compatible fake only for token and HTTP provider boundaries while exercising real MIME construction, digest planning, persistence, retry, and status transitions. Cases cover success, 401/`invalid_grant`, 429, 5xx, malformed response, and bounded sanitized error storage.

### UI and integration

React tests cover preset activation, score ordering, evidence chips, detail explanations, two recipients, connection state, test-email feedback, and retry state. API tests cover validation and stable response shapes. SQL tests confirm the common candidate and due-delivery queries use the new indexes.

Before completion, run focused red-green tests, the full test suite, typecheck, lint, production build, migration snapshot validation, local D1 migration tests, a Gmail test message to both recipients, and private live Sites verification.

## Deployment and activation

1. Generate and inspect the additive immutable D1 migration.
2. Deploy application code and migration privately without changing access.
3. Use Chrome to create the Gmail OAuth client and authorize the send-only scope.
4. Store OAuth values as Sites production secrets and redeploy the saved version to apply the environment revision.
5. Run a test email to each recipient.
6. Record the activation watermark.
7. Run the bounded baseline backfill until complete.
8. Verify existing matches appear on the website but have no notification items.
9. Enable the two-hour profile digest.
10. Verify the next newly discovered eligible job creates exactly one delivery item per recipient.

## Acceptance criteria

- `My Resume Match` returns explainable U.S. internship/co-op results derived from the approved resume profile.
- Existing matches are visible but never included in the first or later email solely because of activation.
- A new qualifying canonical posting is emailed once to each configured recipient.
- A normal refresh does not resend it.
- A genuine reopen after activation creates a new generation and, when it still meets the profile threshold, is emailed exactly once per recipient.
- Gmail authentication failure is visible and does not produce retry spam.
- No OAuth secret or resume document content enters Git, D1, logs, or deployment artifacts.
- Existing job filters, crawl leasing, closure logic, private access, and two-hour crawl behavior remain intact.
