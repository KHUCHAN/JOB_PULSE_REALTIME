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
Full unit/integration suite: 1,327 tests; admission/watchdog suite: 13 tests;
TypeScript check passed.

The initial Sites access failure was resolved. Sites version 321, source
`ed9616285379e5f3dce15402c53ae3c18860b799`, deployed successfully on
2026-09-20 at 05:52:48 UTC, preserving public access. Deployment ID:
`appgdep_6aaf74a8f4308191b2d9159054c6f3ae`. This includes the native Worker
guard/exclusions as well as the Google results-catalog correction below.

The first owner-run audit exposed an overly broad URL rejection for Google's
legitimate `/jobs/results/` catalog. The correction accepts only the catalog
endpoint, not nested individual job URLs; both cases have regression tests.
The production DB confirmed Google's source was refreshed at 05:53:21 UTC
without a source error, and Sanmina at 05:53:25 UTC. Owner run 35492748790
was still running at this verification point; this does not assert that its
entire recovery pipeline succeeded.

Persistent employer 403 challenges and the desktop Chrome/CDP connection
remain separate external limitations, not successful repairs.
