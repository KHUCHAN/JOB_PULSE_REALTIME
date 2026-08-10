# 2027 Tech Internship and Region Filtering Design

## Goal

Make the Jobs page reliably show every open 2027 internship or co-op that belongs to AI/ML, Data/Analytics/Quant, or a direct Software Engineering/Developer discipline, while making United States versus non-U.S. location status visible and filterable.

## Product scope

The feature adds three independent, multi-select job-area filters:

- **AI / ML**
- **Data / Analytics / Quant**
- **Software Engineering**

The Software Engineering area is intentionally narrow. It includes direct software engineering and developer roles such as software engineer, software developer, application developer, frontend, backend, full-stack, mobile, firmware, and explicitly named software-development roles. It does not include a role merely because its title contains `development program`, `product development`, `business systems`, generic IT, cloud, DevOps, security, hardware, or systems engineering. Those roles qualify only when another direct area signal is present.

Pure actuarial, finance, investment, consulting, product, and generic analyst roles do not qualify as Data/Analytics merely because their descriptions mention data tools. Data/Analytics requires a direct structural signal such as data science, data engineering, data analytics, business intelligence, quantitative/quant, informatics, statistics, operations research, or decision science, or sufficiently strong body-and-skill evidence under the existing conservative scoring model.

A role may belong to more than one area. The existing `ai-data` URL and database topic remain supported as a compatibility alias for AI/ML OR Data/Analytics; new UI state uses explicit area keys.

## Internship and recruiting-year semantics

The 2027 preset selects:

- recruiting year `2027`;
- program type `internship` OR `coop`;
- all three job areas.

Program detection continues to use the dedicated internship/co-op classifier rather than `employment_type`. This preserves matches when an ATS omits or mislabels employment type. The recognized title vocabulary includes intern, internship, internships, intern/co-op combinations, co-op, co op, coop, student placement, industrial placement, summer analyst/associate programs when explicitly presented as an internship, and localized punctuation/spacing variants already normalized by the title-token pipeline.

## Region model

Every job receives exactly one derived location region:

- `us`: all trustworthy known work locations are in the United States;
- `non_us`: all trustworthy known work locations are outside the United States;
- `mixed`: the posting contains both U.S. and non-U.S. work locations;
- `unknown`: no trustworthy country inference is possible.

Classification uses structured `location_country`, every structured secondary location, and then normalized raw location text. The fallback recognizes full U.S. names, U.S. state names and unambiguous city/state-code forms. Ambiguous two-letter tokens are not treated as countries or states without location context. Generic values such as `Remote`, `Multiple locations`, `Flexible`, and `Location not specified` remain `unknown` unless another structured location resolves them.

The UI exposes `All`, `United States`, `Outside U.S.`, `Mixed`, and `Unknown`. A compact `US`, `Non-US`, `Mixed`, or `Unknown` badge appears beside every result location. This avoids silently treating incomplete data as non-U.S.

## Data model and indexing

Area membership is stored in `job_topics` with stable keys:

- `area:ai-ml`
- `area:data-analytics`
- `area:software-engineering`

`jobs.location_region` stores `us`, `non_us`, `mixed`, or `unknown`. A new `jobs.area_classified_at` field separates this backfill from the legacy `topic_classified_at` state. The migration is additive and immutable and adds an index over `(status, location_region, first_seen_at)` for filtered newest-first queries.

New and refreshed jobs are classified during persistence. Existing open jobs are processed by bounded, retry-safe backfills so deployment does not require one oversized D1 transaction. Reclassification replaces only the managed `area:*` topics for that job and preserves unrelated topics.

## Search and URL behavior

`JobFilters` gains `areas` and `regions`. Repeated URL parameters provide stable deep links:

```text
/jobs?year=2027&program=internship&program=coop&area=ai-ml&area=data-analytics&area=software-engineering&region=us
```

Multiple selected areas use OR semantics. Multiple program types already use OR semantics. Different filter families combine with AND, so the preset means `2027 AND (internship OR coop) AND (AI/ML OR Data/Analytics/Quant OR Software Engineering)`.

Legacy `/jobs?topic=ai-data` links continue to return AI/ML or Data/Analytics results. Canonical official-URL deduplication remains before all filters so facets, counts, and result rows agree.

## Jobs-page experience

The existing common filter bar gains:

- a renamed `2027 Tech Internships` preset;
- three area toggle controls in the structured filter sheet;
- a first-class Region select in the common bar, not hidden only under advanced filters.

Each desktop and mobile result displays company, role, raw location, region badge, arrangement, area badges, and posting timing. When the ATS provides `published_at`, the row labels the absolute date as `Posted`. When the ATS has no trustworthy posting date, the row labels `first_seen_at` as `First seen` so the UI does not misrepresent crawler discovery time as the employer's posting time. The existing country filter remains available for exact-country refinement.

## Backfill and deployment

Deployment order is migration, application deployment, then bounded backfill requests until `area_classified_at` has no remaining open jobs and no open job has a null `location_region`. The current two-hour crawl continues normal source leasing and classifies refreshed jobs automatically.

Production verification must confirm:

- Motorola Solutions `R67461` matches the 2027 preset and AI/ML or Software Engineering as evidence permits;
- ConocoPhillips `REQ-006200` matches the 2027 preset through its AI/Data body evidence even though the title is generic IT;
- SpaceX 2027 Software Engineering internship/co-op roles match Software Engineering;
- generic `Leadership Development Program` and `Sustainable Development` titles do not match Software Engineering;
- a U.S., non-U.S., mixed-location, and unknown-location fixture each returns only under the correct region filter;
- existing `topic=ai-data` links remain functional.

## Testing and acceptance

Classifier unit tests cover direct positives, misleading development negatives, multi-area roles, punctuation variants, and body-only evidence. Region unit tests cover structured countries, secondary locations, city/state fallbacks, ambiguity, mixed locations, and unknowns. SQL and URL-codec tests cover OR/AND semantics, case-insensitivity, canonical deduplication, legacy compatibility, and index use. React tests cover preset state, visible region selection, active-filter chips, area/region badges, `Posted` versus `First seen` timing, and mobile/desktop rendering.

All focused tests, the full test suite, typecheck, lint, production build, migration snapshot validation, and an in-app browser pass against the private live deployment must pass before completion.
