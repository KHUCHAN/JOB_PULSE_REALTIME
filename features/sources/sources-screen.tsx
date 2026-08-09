"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import type { SourceHealth } from "../../lib/domain";
import { formatDateTime, titleCase } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";

export function SourcesScreen(): ReactElement {
  const { repository, revision, demoMode } = useJobPulse();
  const [health, setHealth] = useState<"all" | SourceHealth>("all");
  const query = useRepositoryQuery(() => repository.listSources(health), [revision, health]);
  const sources = query.data ?? [];

  return (
    <div className="page-stack sources-page">
      <header className="page-heading">
        <div>
          <h1>Sources</h1>
          <p>Track every official career endpoint, adapter, change, and extraction issue.</p>
        </div>
        <div className="source-summary"><RefreshCw size={15} aria-hidden="true" /><span>{sources.length} monitored in view</span></div>
      </header>

      <section className="compact-filter surface" aria-label="Source filters">
        <div className="filter-control">
          <label htmlFor="source-health">Source health</label>
          <select id="source-health" value={health} onChange={(event) => setHealth(event.target.value as "all" | SourceHealth)}>
            <option value="all">All health states</option><option value="healthy">Healthy</option><option value="changed">Changed</option><option value="blocked">Blocked</option><option value="failed">Failed</option><option value="inactive">Inactive</option>
          </select>
        </div>
        <p>Posting and Talent URLs stay separate so each workflow can be verified independently.</p>
      </section>

      <section className="surface sources-surface">
        <div className="section-heading">
          <div><h2>Monitored career sources</h2><p>Verified company endpoints and their latest extraction state.</p></div>
          <span className="demo-note"><strong>{demoMode ? "Demo data" : "Live database"}</strong> · official endpoints</span>
        </div>
        {query.loading ? <LoadingState label="Loading sources" /> : null}
        {query.error ? <ErrorState retry={query.retry} /> : null}
        {!query.loading && !query.error && sources.length === 0 ? <EmptyState title="No sources in this state" /> : null}
        {!query.loading && !query.error && sources.length ? (
          <div className="table-wrap">
            <table className="data-table sources-table" aria-label="Monitored sources">
              <thead><tr><th>Company</th><th>Adapter</th><th>HTTP</th><th>Extraction health</th><th>Jobs</th><th>Last checked</th><th>Last changed</th><th>Next run</th><th><span className="sr-only">Career link</span></th></tr></thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td><strong>{source.company}</strong><span>{source.talentUrl ? "Talent URL verified" : "Posting URL only"}</span></td>
                    <td><span className="adapter-label">{titleCase(source.adapter)}</span></td>
                    <td>{source.httpStatus ?? <span className="no-portal">No active portal</span>}</td>
                    <td><StatusBadge status={source.health} /></td>
                    <td><b>{source.currentJobs}</b></td>
                    <td>{formatDateTime(source.lastCheckedAt)}</td>
                    <td>{formatDateTime(source.lastChangedAt)}</td>
                    <td>{formatDateTime(source.nextRunAt)}</td>
                    <td>{source.postingUrl ? <a className="row-action" href={source.postingUrl} target="_blank" rel="noreferrer" aria-label={`Open ${source.company} careers`}><ExternalLink size={15} aria-hidden="true" /></a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
