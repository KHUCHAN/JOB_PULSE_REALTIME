"use client";

import {
  AlertTriangle,
  BellDot,
  BriefcaseBusiness,
  Building2,
  UserRoundSearch,
} from "lucide-react";
import type { ReactElement } from "react";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { MetricCard } from "../../components/ui/metric-card";
import { StatusBadge } from "../../components/ui/status-badge";
import { CompanyLogo } from "../../components/ui/company-logo";
import { useJobPulse } from "../../components/fixture-provider";
import { formatRelativeDate } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";

export function OverviewScreen(): ReactElement {
  const { repository, revision } = useJobPulse();
  const query = useRepositoryQuery(
    async () => {
      const [overview, sources, talent] = await Promise.all([
        repository.getOverview(),
        repository.listSources(),
        repository.listTalentTargets(),
      ]);
      return { overview, sources, talent };
    },
    [revision],
  );

  if (query.loading) return <LoadingState label="Loading overview" />;
  if (query.error || !query.data) return <ErrorState retry={query.retry} />;

  const { overview, sources, talent } = query.data;
  const sourceRail = sources.slice(0, 5);
  const talentCoverage = talent.slice(0, 3);

  return (
    <div className="page-stack overview-page">
      <header className="page-heading overview-heading">
        <div>
          <h1>Overview</h1>
          <p>One clear view of what changed, what matched, and what needs you next.</p>
        </div>
        <div className="run-context">
          <span>Next scheduled pass</span>
          <strong>Every 2 hours</strong>
        </div>
      </header>

      <section className="metrics-strip" aria-label="Operational summary">
        <MetricCard label="New matching jobs" value={overview.newMatches} detail="Ready to review" icon={BriefcaseBusiness} />
        <MetricCard label="Active sources" value={overview.activeSources} detail="Extracting normally" icon={Building2} />
        <MetricCard label="Source errors" value={overview.sourceErrors} detail="Need a closer look" icon={AlertTriangle} />
        <MetricCard label="Unsent alerts" value={overview.unsentAlerts} detail="Waiting for backend" icon={BellDot} />
        <MetricCard label="Talent links" value={talent.length} detail="Verified directory" icon={UserRoundSearch} />
      </section>

      <div className="overview-grid">
        <section className="surface latest-jobs-panel">
          <div className="section-heading">
            <div>
              <h2>Latest matching jobs</h2>
              <p>Ranked by freshness and keyword relevance.</p>
            </div>
            <a className="text-link" href="/jobs">View all jobs</a>
          </div>

          {overview.latestJobs.length ? (
            <div className="table-wrap">
              <table className="data-table overview-jobs-table">
                <thead>
                  <tr><th>Role</th><th>Location</th><th>Match</th><th>Seen</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {overview.latestJobs.map((job) => (
                    <tr key={job.id}>
                      <td><strong>{job.title}</strong><span>{job.company}</span></td>
                      <td>{job.location}</td>
                      <td><b className="match-score">{job.matchScore}%</b></td>
                      <td>{formatRelativeDate(job.firstSeenAt)}</td>
                      <td><StatusBadge status={job.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No matching jobs" />}
        </section>

        <aside className="overview-rail">
          <section className="surface rail-panel source-health-panel">
            <div className="section-heading compact">
              <div><h2>Source health</h2><p>{overview.activeSources} currently active</p></div>
              <a className="text-link" href="/sources">Inspect</a>
            </div>
            <div className="health-list">
              {sourceRail.map((source) => (
                <div className="health-row" key={source.id}>
                  <CompanyLogo company={source.company} />
                  <div><strong>{source.company}</strong><span>{source.currentJobs} current roles</span></div>
                  <StatusBadge status={source.health} />
                </div>
              ))}
            </div>
          </section>

          <section className="surface rail-panel">
            <div className="section-heading compact">
              <div><h2>Recent activity</h2><p>Latest repository events</p></div>
              <a className="text-link" href="/activity">History</a>
            </div>
            <div className="activity-list compact-list">
              {overview.recentActivity.slice(0, 4).map((event) => (
                <div className="activity-row" key={event.id}>
                  <span className={`event-marker ${event.severity}`} aria-hidden="true" />
                  <div><strong>{event.summary}</strong><span>{formatRelativeDate(event.occurredAt)}</span></div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="surface talent-preview">
        <div className="section-heading">
          <div><h2>Talent Harness coverage</h2><p>Verified links and capability checks only — registration runs on the official site.</p></div>
          <a className="text-link" href="/talent">Browse directory</a>
        </div>
        <div className="talent-preview-list">
          {talentCoverage.map((target) => (
            <article key={target.id}>
              <CompanyLogo company={target.company} large />
              <div className="talent-preview-copy"><strong>{target.company}</strong><span>{target.ats} · Official Talent endpoint</span></div>
              <a className="talent-preview-link" href={target.talentUrl} target="_blank" rel="noreferrer">Open</a>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
