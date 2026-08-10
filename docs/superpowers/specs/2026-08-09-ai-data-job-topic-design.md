# AI & Data Science Job Topic Design

## Goal

Make the Jobs page useful for reviewing every currently open AI and Data Science-related role while keeping company and role names immediately scannable. The first page of results must no longer wait for the global filter-option aggregation that currently makes a cold filtered request take roughly 33 seconds.

## User experience

- Add an `AI & Data Science` preset beside the common Jobs filters.
- Activating it writes `topic=ai-data` to the URL so the view can be bookmarked and shared within the private Site.
- The active topic appears as a removable filter chip and combines with every existing structured filter.
- Desktop results use separate `Company` and `Role` columns. Company shows the local logo when available, a fallback initial otherwise, and the full company name. Role shows the full title with the official posting action unchanged.
- Mobile results show company identity first and the role title as the dominant line beneath it.
- Results continue to include only open canonical postings and remain ordered newest first.

## Topic definition

The `ai-data` topic is broad, but it is not a match for every posting that casually mentions AI.

Classify from these collected fields:

- title, summary, description, responsibilities, and qualifications;
- skills;
- department, team, business unit, job family, and job function.

Strong domains include:

- artificial intelligence, machine learning, deep learning, generative AI, GenAI;
- large language models, LLMs, NLP, natural-language processing;
- computer vision, reinforcement learning, speech or recommendation systems;
- data science, data scientist, decision scientist, applied scientist, research scientist;
- data engineering, analytics engineering, data analysis, data analytics, business intelligence;
- ML engineering, MLOps, model infrastructure, and AI/data platforms.

Matching rules:

1. A strong domain phrase in title, department, team, job family, or job function is sufficient.
2. An exact technical skill or role phrase is sufficient when it identifies the job domain, such as `PyTorch`, `TensorFlow`, `LLM`, `NLP`, `MLOps`, or `data engineering`.
3. Body-only matches require either one role/domain phrase or two independent supporting signals. A single incidental phrase such as “use AI tools” does not qualify.
4. Short signals such as `AI`, `ML`, and `BI` use token boundaries and never match inside unrelated words.
5. Classification is deterministic and stores the matching evidence so false positives can be audited.

## Data model and indexing

Add a `job_topics` table:

- `job_id` references `jobs.id` with cascade deletion;
- `topic_key` stores `ai-data`;
- `score` stores the deterministic classification score;
- `evidence` stores a compact JSON array of matched signals;
- `classified_at` records when the membership was calculated;
- the primary key is `(job_id, topic_key)`;
- an index on `(topic_key, job_id)` supports topic-first lookup.

The crawler classifies each normalized job before persistence. After each jobs upsert chunk, topic memberships are upserted for matching jobs and removed for jobs that no longer match. Existing open jobs are backfilled once during rollout in bounded chunks; the backfill is resumable and does not hold the production request open.

The job search plan implements `topic=ai-data` as an indexed membership condition while retaining the existing canonical-URL deduplication and all other filters.

## Query latency design

The Jobs response currently waits for three operations: the page query, total count, and a 26-key global filter-option aggregation. The global aggregation scans and transforms the full open-job catalog and returns about 120 KB even when the user only needs the first results page.

Change the flow as follows:

1. The Jobs API returns page rows and total count without global filter options.
2. Filter options move to a separate endpoint and load asynchronously. Common controls remain usable while their suggestions load.
3. The advanced filter panel requests options on first open and reuses the result for the session.
4. Topic membership is precomputed, so AI/Data Science queries do not run multi-field `LIKE` or JSON scans at request time.
5. The API keeps list projections small; full descriptions remain detail-only.

Target performance on the production-size catalog:

- filtered results render within 3 seconds on a cold request and within 1 second when warm;
- opening or refreshing the filter suggestions never blocks the result table;
- the Jobs list response excludes the global filter-options payload.

## Components and boundaries

- `job-topic-classifier`: pure deterministic classification and evidence generation.
- `job_topics` persistence: migration, bounded backfill, and crawler synchronization.
- job filter codec and SQL: parse, serialize, validate, and execute `topic=ai-data`.
- filter-options endpoint: independently loads structured option counts.
- Jobs UI: preset control, active chip, separated Company and Role presentation.

Each boundary has a narrow contract so vocabulary changes do not require UI or query rewrites.

## Error handling and correctness

- A failed topic-membership write fails that source sync rather than silently publishing incomplete classification.
- A backfill checkpoint makes deployment retries idempotent.
- Unknown topic keys return a 400 response instead of falling back to an unfiltered catalog.
- Quick topic filtering never changes job open/closed state.
- Existing URL filters and review states continue to compose with the topic.

## Validation

- Classifier unit tests cover every domain family, token boundaries, incidental AI mentions, structured fields, and sparse records.
- SQL tests prove topic membership uses the new index and composes with company, location, year, program, and review-state filters.
- Migration tests verify idempotent backfill and cascade cleanup.
- API tests prove result responses omit filter options and option loading is independent.
- Component tests verify the preset, URL state, removable chip, separate Company and Role labels, and mobile hierarchy.
- Production-size timing compares the current 2027 Internship/Co-op query and the new AI/Data Science query before and after the change.
- Browser QA checks desktop and mobile rendering, console health, topic interaction, URL state, and official-link access.
- A sampled audit of at least 100 classified postings targets at least 90% precision; misses found in known AI/Data Science title fixtures must be zero.

## Non-goals

- This change does not introduce an LLM classifier or external embedding service.
- It does not redesign the crawler schedule or solve conditional HTTP crawling.
- It does not make the private Site public or alter access control.
- It does not add unrelated job topics in this iteration.
