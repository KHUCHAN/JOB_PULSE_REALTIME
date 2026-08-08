"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import type { ActivityEvent, ActivityKind } from "../../lib/domain";
import { formatDateTime, titleCase } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";

const kinds: ActivityKind[] = [
  "crawl.demo", "source.changed", "source.failed", "job.created", "job.updated",
  "job.closed", "match.created", "email.sent", "email.failed", "talent.updated",
];

export function ActivityScreen(): ReactElement {
  const { repository, revision } = useJobPulse();
  const [severity, setSeverity] = useState<"all" | ActivityEvent["severity"]>("all");
  const [kind, setKind] = useState<"all" | ActivityKind>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useRepositoryQuery(() => repository.listActivity({ severity, kind }), [revision, severity, kind]);
  const events = query.data ?? [];

  return (
    <div className="page-stack activity-page">
      <header className="page-heading">
        <div><h1>Activity</h1><p>A human-readable history with technical details available only when you need them.</p></div>
        <span className="result-count">{events.length} events</span>
      </header>

      <section className="compact-filter two-up surface" aria-label="Activity filters">
        <div className="filter-control">
          <label htmlFor="activity-severity">Severity</label>
          <select id="activity-severity" value={severity} onChange={(event) => setSeverity(event.target.value as "all" | ActivityEvent["severity"])}>
            <option value="all">All severities</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option>
          </select>
        </div>
        <div className="filter-control">
          <label htmlFor="activity-kind">Event kind</label>
          <select id="activity-kind" value={kind} onChange={(event) => setKind(event.target.value as "all" | ActivityKind)}>
            <option value="all">All event kinds</option>
            {kinds.map((item) => <option value={item} key={item}>{titleCase(item.replace(".", " "))}</option>)}
          </select>
        </div>
        <p>Newest events appear first. Technical IDs are kept out of the primary scan path.</p>
      </section>

      <section className="surface activity-surface">
        <div className="section-heading"><div><h2>Event history</h2><p>Monitoring, alert, job, and assisted-flow changes.</p></div><span className="demo-note">Demo data</span></div>
        {query.loading ? <LoadingState label="Loading activity" /> : null}
        {query.error ? <ErrorState retry={query.retry} /> : null}
        {!query.loading && !query.error && events.length === 0 ? <EmptyState title="No activity matches these filters" /> : null}
        {!query.loading && !query.error && events.length ? (
          <div className="event-feed">
            {events.map((event) => {
              const isOpen = expanded === event.id;
              return (
                <article className="event-item" key={event.id}>
                  <span className={`event-marker ${event.severity}`} aria-hidden="true" />
                  <div className="event-copy">
                    <div className="event-title-line"><strong>{event.summary}</strong><StatusBadge status={event.severity} /></div>
                    <span>{titleCase(event.kind.replace(".", " "))} · {formatDateTime(event.occurredAt)}</span>
                    {isOpen ? <div className="technical-details"><code>{event.technicalId}</code><p>{event.details}</p></div> : null}
                  </div>
                  <button className="detail-toggle" type="button" aria-label={isOpen ? "Hide technical details" : "Show technical details"} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : event.id)}>
                    {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </button>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
