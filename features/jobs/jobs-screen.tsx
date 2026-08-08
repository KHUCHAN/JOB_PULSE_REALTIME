"use client";

import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import type { JobPosting, JobState, WorkArrangement } from "../../lib/domain";
import { formatRelativeDate } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";
import { JobDetailDrawer } from "./job-detail-drawer";

export function JobsScreen({ initialQuery = "" }: { initialQuery?: string }): ReactElement {
  const { repository, revision, mutate } = useJobPulse();
  const [search, setSearch] = useState(initialQuery);
  const [status, setStatus] = useState<"all" | JobState>("all");
  const [arrangement, setArrangement] = useState<"all" | WorkArrangement>("all");
  const [location, setLocation] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  const query = useRepositoryQuery(
    () => repository.listJobs({ query: search, status, arrangement, location }),
    [revision, search, status, arrangement, location],
  );

  const jobs = [...(query.data ?? [])].sort(
    (a, b) =>
      b.firstSeenAt.localeCompare(a.firstSeenAt) ||
      b.matchScore - a.matchScore ||
      a.company.localeCompare(b.company),
  );
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? null;

  const openDetails = (job: JobPosting, event: MouseEvent<HTMLButtonElement>) => {
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
    setMessage(`Demo data · ${selectedJob.title} marked ${state}.`);
  };

  return (
    <div className="page-stack jobs-page">
      <header className="page-heading">
        <div>
          <h1>Jobs</h1>
          <p>Review every match in one place, then keep the useful signal and hide the rest.</p>
        </div>
        <span className="result-count">{jobs.length} roles in view</span>
      </header>

      <section className="filter-bar" aria-label="Job filters">
        <div className="filter-search">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="job-search">Search jobs</label>
          <input id="job-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Role, company, or keyword" />
        </div>
        <div className="filter-control">
          <label htmlFor="job-status">Job status</label>
          <select id="job-status" value={status} onChange={(event) => setStatus(event.target.value as "all" | JobState)}>
            <option value="all">All statuses</option><option value="new">New</option><option value="saved">Saved</option><option value="hidden">Hidden</option><option value="applied">Applied</option>
          </select>
        </div>
        <div className="filter-control">
          <label htmlFor="arrangement">Work arrangement</label>
          <select id="arrangement" value={arrangement} onChange={(event) => setArrangement(event.target.value as "all" | WorkArrangement)}>
            <option value="all">Any arrangement</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option>
          </select>
        </div>
        <div className="filter-control location-control">
          <label htmlFor="job-location">Location</label>
          <input id="job-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Any location" />
        </div>
        <SlidersHorizontal className="filter-glyph" aria-hidden="true" />
      </section>

      {message ? <div className="inline-feedback" aria-live="polite">{message}</div> : null}

      <section className="surface jobs-surface">
        <div className="section-heading">
          <div><h2>Matching roles</h2><p>Newest first, then strongest relevance.</p></div>
          <span className="demo-note">Demo data · official links open separately</span>
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
      </section>

      {selectedJob ? <JobDetailDrawer job={selectedJob} onClose={closeDetails} onChangeState={changeState} /> : null}
    </div>
  );
}
