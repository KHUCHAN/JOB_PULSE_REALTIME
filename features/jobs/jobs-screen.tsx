"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import type { JobFilters, JobState } from "../../lib/domain";
import { formatRelativeDate } from "../../lib/format";
import { defaultJobFilters, parseJobFilterParams, serializeJobFilters } from "../../lib/job-filter-query";
import type { RichJobPosting } from "../../lib/pulse-mappers";
import { useRepositoryQuery } from "../../lib/use-repository-query";
import { ActiveFilterChips } from "./active-filter-chips";
import { JobDetailDrawer } from "./job-detail-drawer";
import { JobFilterPanel } from "./job-filter-panel";

const filtersFromLocation = (initialQuery: string): JobFilters => {
  if (typeof window === "undefined") return { ...defaultJobFilters, query: initialQuery };
  const fromUrl = parseJobFilterParams(new URLSearchParams(window.location.search));
  return { ...fromUrl, query: initialQuery || fromUrl.query };
};

const arrayFilterKeys = new Set<keyof JobFilters>([
  "companies", "cities", "states", "countries", "employmentTypes", "recruitingYears", "programTypes", "seasons", "departments", "teams", "businessUnits", "jobFamilies", "jobFunctions", "industries", "offices", "skills", "experienceLevels", "salaryCurrencies", "salaryIntervals", "educationRequirements", "shiftSchedules", "travelRequirements", "securityClearances", "languages",
]);

export function JobsScreen({ initialQuery = "" }: { initialQuery?: string }): ReactElement {
  const { repository, revision, mutate, demoMode } = useJobPulse();
  const [filters, setFilters] = useState<JobFilters>(() => filtersFromLocation(initialQuery));
  const [search, setSearch] = useState(() => filtersFromLocation(initialQuery).query);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => current.query === search ? current : { ...current, query: search, page: 1 });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const query = serializeJobFilters(filters).toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [filters]);

  const query = useRepositoryQuery(
    () => repository.searchJobs(filters),
    [revision, filters],
  );
  const result = query.data;
  const jobs = result?.items ?? [];
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? null;
  const total = result?.total ?? 0;
  const page = result?.page ?? filters.page ?? 1;
  const pageSize = result?.pageSize ?? filters.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateFilters = (patch: Partial<JobFilters>, resetPage = true) => {
    setFilters((current) => ({ ...current, ...patch, page: resetPage ? 1 : patch.page ?? current.page }));
  };

  const removeFilter = (key: keyof JobFilters, value?: string | number) => {
    if (arrayFilterKeys.has(key)) {
      setFilters((current) => ({
        ...current,
        [key]: ((current[key] as Array<string | number> | undefined) ?? []).filter((item) => item !== value),
        page: 1,
      }));
      return;
    }
    const defaults = defaultJobFilters[key];
    setFilters((current) => ({ ...current, [key]: defaults, page: 1 }));
    if (key === "query") setSearch("");
  };

  const clearFilters = () => {
    setFilters({ ...defaultJobFilters });
    setSearch("");
  };

  const openDetails = (job: RichJobPosting, event: MouseEvent<HTMLButtonElement>) => {
    lastTrigger.current = event.currentTarget;
    setSelectedId(job.id);
  };

  const closeDetails = () => {
    setSelectedId(null);
    window.setTimeout(() => lastTrigger.current?.focus(), 0);
  };

  const changeState = async (state: JobState) => {
    if (!selectedJob) return;
    await mutate(() => repository.updateJobState(selectedJob.id, state));
    setMessage(`${demoMode ? "Demo data · " : ""}${selectedJob.title} marked ${state}.`);
  };

  const goToPage = (nextPage: number) => updateFilters({ page: nextPage }, false);

  return (
    <div className="page-stack jobs-page">
      <header className="page-heading">
        <div>
          <h1>Jobs</h1>
          <p>Review every match in one place, then keep the useful signal and hide the rest.</p>
        </div>
        <span className="result-count">{total} roles found</span>
      </header>

      <JobFilterPanel filters={filters} options={result?.availableFilters} search={search} advancedOpen={advancedOpen} onSearchChange={setSearch} onChange={updateFilters} onAdvancedOpenChange={setAdvancedOpen} />
      <ActiveFilterChips filters={filters} onRemove={removeFilter} onClear={clearFilters} />

      {message ? <div className="inline-feedback" aria-live="polite">{message}</div> : null}

      <section className="surface jobs-surface">
        <div className="section-heading">
          <div><h2>Matching roles</h2><p>Newest first, then strongest relevance.</p></div>
          <span className="demo-note"><strong>{demoMode ? "Demo data" : "Live database"}</strong> · official links open separately</span>
        </div>

        {query.loading ? <LoadingState label="Loading jobs" /> : null}
        {query.error ? <ErrorState retry={query.retry} /> : null}
        {!query.loading && !query.error && jobs.length === 0 ? <EmptyState title="No jobs match these filters" detail="Clear one or more filters to widen the view." /> : null}

        {!query.loading && !query.error && jobs.length ? (
          <>
            <div className="table-wrap desktop-jobs-table">
              <table className="data-table jobs-table" aria-label="Matching jobs">
                <thead><tr><th>Role</th><th>Location</th><th>Arrangement</th><th>Matched</th><th>Seen</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td><strong>{job.title}</strong><span>{job.company}</span></td>
                      <td>{job.location}</td>
                      <td>{job.arrangement}</td>
                      <td><b className="match-score">{job.matchScore}%</b><span>{job.matchedTerms.join(" · ")}</span></td>
                      <td>{formatRelativeDate(job.firstSeenAt)}</td>
                      <td><StatusBadge status={job.status} /></td>
                      <td><button className="row-action" type="button" aria-label={`View ${job.title} details`} onClick={(event) => openDetails(job, event)}><ArrowUpRight size={16} aria-hidden="true" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-job-list">
              {jobs.map((job) => (
                <article className="mobile-job-card" key={job.id}>
                  <div className="mobile-job-top"><span className="company-avatar">{job.company.slice(0, 1)}</span><div><strong>{job.title}</strong><span>{job.company}</span></div><StatusBadge status={job.status} /></div>
                  <p>{job.location} · {job.arrangement}</p>
                  <div className="mobile-job-bottom"><span><b>{job.matchScore}%</b> match</span><button className="button secondary" type="button" aria-label={`View ${job.title} details`} onClick={(event) => openDetails(job, event)}>Details <ArrowUpRight size={15} /></button></div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {!query.loading && !query.error && result ? (
          <nav className="pagination" aria-label="Job result pages">
            <button className="button secondary" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button className="button secondary" type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next</button>
          </nav>
        ) : null}
      </section>

      {selectedJob ? <JobDetailDrawer job={selectedJob} onClose={closeDetails} onChangeState={changeState} /> : null}
    </div>
  );
}
