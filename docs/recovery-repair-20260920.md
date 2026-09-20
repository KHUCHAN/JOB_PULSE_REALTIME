# Recovery repair, 2026-09-20

## Confirmed causes

- AMD's durable source URL contained an escaped internal iCIMS link. Use its
  public Jibe API and construct job URLs from the verified public listing.
- Loews' source had been promoted to an expired individual job. Its employer
  detail page links the public `loewshotels` Workday tenant; use that catalog.
- Sanmina's stored `careers.sanmina.com` API no longer resolved. The employer's
  `www.sanmina.com/careers/` links its public Deltek/hrdepartment catalog.
- Browser native retries and curl processes could outlive the source deadline
  and consume the time intended for browser inspection.
- Verified empty catalogs were included in `unresolved`; persistence failures
  could be classified as successful when jobs were present.

## Changes and safety

Reject escaped URLs, internal portals, and deep individual job URLs as source
roots, including in native persistence. Pin the three verified public catalogs.
Sanmina validates table structure, range, stable total and distinct posting IDs
across all pages; requisition revisions remain distinct from posting IDs. It
does not invent dates absent from the official listing.

Bound native and HTTP probe stages with shared abort signals, including curl
subprocesses. Reserve browser time inside a 60-second source lease and use eight
browser workers. Separate authoritative empty results from unresolved failures.

The final workflow audit reconciles request failures against completed browser
recovery. Earlier collection steps retain their logs but defer the terminal
decision to that audit. Missing artifacts, incomplete browser runs, DB audit
errors, unresolved sources and persistence failures still fail the workflow.
Main-drain success remains independent of partial recovery failure.

No changes to Gmail recipients, selection, notification identity state, the
72-hour official-date rule, public access, or owner admission/concurrency.
No direct crawl API or second crawler is introduced.

## Verification

Read-only live adapter checks recovered AMD 618, Loews 281 and Sanmina 754
records with complete catalog evidence. These checks did not ingest or email.
Full unit/integration suite: 1,326 tests; admission/watchdog suite: 13 tests;
TypeScript check passed.

The Sites connector currently returns `sites_access_disabled` for this
workspace. GitHub runner changes can be published independently, but the
native Worker guard/exclusion changes require a subsequent Sites publication.
Do not claim those Worker changes are live until deployment is verified.
Persistent employer 403 challenges and the desktop Chrome/CDP connection
remain separate external limitations, not successful repairs.
