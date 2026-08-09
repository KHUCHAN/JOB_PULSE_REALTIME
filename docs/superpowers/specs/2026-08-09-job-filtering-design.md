# Job filtering design

## Goal

Expose the structured fields already collected for each open job as real, composable filters on the Jobs page. A user must be able to reproduce the current 2027 internship export in the product using `Recruiting year = 2027` and `Program type = Internship or Co-op`, without relying on broad full-text search.

## Considered approaches

1. **Full-text search only.** Add preset query strings such as `2027 intern`. This is simple but keeps the current false positives, 300-row ceiling, and inability to combine reliable structured conditions.
2. **Source-native facets only.** Build the UI directly from `source_facets`. This preserves ATS labels but mixes incompatible provider keys, can contain source-level counts that do not reflect the current result set, and does not cover every normalized job field.
3. **Normalized job filters with source facets as supplemental metadata.** Query canonical columns on `jobs`, expose bounded value lists, and retain source facets only for labels or provider-specific discovery. This is the selected approach because it gives predictable cross-company behavior while using the data already collected.

## User experience

The always-visible filter row contains:

- Full-text search
- Company
- Location
- Work arrangement
- Employment type
- A `More filters` button with the active advanced-filter count

The advanced filter panel contains:

- Recruiting year
- Program type: Internship, Co-op, or regular role
- Season: Spring, Summer, Fall, Winter
- Posted date range
- Department, team, business unit, job family, job function, industry, and office
- Skills
- Experience level
- Salary minimum, maximum, currency, and interval
- Education, shift, travel, security clearance, and languages

Selected filters appear as removable chips above the results. `Clear all` resets them. Filter state is encoded in the URL so a result set can be bookmarked or shared. Desktop uses the existing horizontal bar plus a right-side advanced panel; mobile uses the same controls in a full-width sheet. This extends the existing visual system rather than redesigning the page.

## Exact internship semantics

`Recruiting year = 2027` matches the four-digit year in the job title for program searches. `Program type = Internship` matches `intern` or `internship` in the title. `Program type = Co-op` matches `co-op`, `co op`, or `coop` in the title. Combining year 2027 with Internship and Co-op therefore reproduces title-qualified 2027 programs and excludes descriptions that merely mention 2027.

Results are deduplicated by normalized official URL for display and counts. Only `jobs.status = 'open'` is shown. Jobs missing a particular field remain visible when that filter is unset and are excluded only when a value for that field is selected.

## Data and API design

Add a paginated job-search response containing `items`, `total`, `page`, `pageSize`, and `availableFilters`. The API accepts repeated or comma-separated values for multi-select fields and validates numeric/date inputs. Common filters use canonical `jobs` columns. JSON arrays such as skills and languages use SQLite JSON membership checks. Year, program type, and season use bounded, escaped title predicates with explicit semantics above.

The result projection includes the collected structured fields needed by the table, detail drawer, and filter chips. Page size defaults to 50 and is capped at 100. A stable order of `first_seen_at DESC, company ASC, id ASC` prevents page drift. The existing overview query continues to request only its five latest jobs.

`availableFilters` returns bounded, current open-job values and counts. High-cardinality filters expose the most common values plus server-side text matching rather than returning unbounded lists. New indexes cover the common equality/range predicates used by company, arrangement, employment type, location components, publication date, experience level, salary, and program/year expressions where practical.

## Component boundaries

- `job-filter-query`: parses, normalizes, serializes, and clears URL-backed filter state.
- `job-search-sql`: builds parameterized SQL predicates and pagination from validated filters.
- `job-filter-panel`: renders common and advanced controls without owning data access.
- `active-filter-chips`: renders removable selections and the clear-all action.
- `jobs-screen`: coordinates repository requests, pagination, loading/error states, and the existing detail drawer.
- Repository/API types carry paginated results and available filter values.

## Error handling and performance

All SQL remains parameterized. Invalid filter values return HTTP 400 with a readable message. Empty result sets preserve active controls and offer `Clear all`. A failed facet request does not hide already loaded jobs; it disables only affected choice lists and allows retry. Requests triggered by rapid typing are debounced and stale responses are ignored.

Value lists and counts are bounded. Large result sets are never returned in one response. The production query plan and response time are checked against the current D1 dataset before deployment.

## Testing and acceptance

Tests are written before implementation and cover:

- URL parsing and serialization for every filter type
- Parameterized SQL predicates, multi-select behavior, missing values, and invalid inputs
- Exact 2027 Internship/Co-op title semantics and official-URL deduplication
- Pagination totals and stable page ordering
- API repository serialization and response mapping
- Desktop and mobile control behavior, chips, clear-all, loading, empty, and error states
- Regression coverage for existing search, review-state updates, overview, and detail drawer behavior

Acceptance requires the production Jobs page to reproduce the current unique 2027 Internship/Co-op set using structured filters, show the exact total, paginate through all matches, preserve official links, and combine correctly with company, location, season, work arrangement, and the advanced collected fields.
