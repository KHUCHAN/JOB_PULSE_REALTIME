# Reader proxy (`r.jina.ai`) usage in lib/crawler.ts

Static inspection only (Round 2, no requests made): 35 literals in 22 functions. Counts use 1,476 configured source rows (2026-11-02 08:16Z) and show eligibility, not observed traffic; routes overlap, do not sum. Many routes are NOT challenge-only.

- Generic: `crawlReaderFallback` (called by `crawlJsonLd` after blocked HTTP, empty pages or caught errors; recursive on discovered listings; upper bound 1,476 rows, Custom+Phenom pool 992) and `readerMarkdown` (Delta normal path, IBM detail enrichment, Avature pagination).
- Avature `/careers/SearchJobs`: 5 URLs (Bloomberg, CBRE, Delta, EA, Rohde & Schwarz). CBRE has its own API path.
- Talemetry: 58 URL matches (superset); map-reader tenants Alvarez & Marsal, Penn Medicine; throttled catalog tenants CDW, A&M, Atrium; others try JSON then reader.
- Reader on the normal path: Northwestern Mutual, FBI (3 sources), Citadel details, SAIC dates, Coinbase, American Family, ASE Group, Tower Semiconductor, Penn Medicine details.
- Reader as fallback: Jobsyn sitemap callers (Graybar, Burlington, Alaska Air, Cummins, Siemens EDA, Southern Company, Jacobs), Ameriprise, Revolut, ServiceNow, Meta/Meta FAIR, Whatnot, Barclays details, SAIC catalog.
- `cgiNjoynReaderUrl`: declared, no call sites.
- Exact reachable counts for the two generic routes are unverified.
