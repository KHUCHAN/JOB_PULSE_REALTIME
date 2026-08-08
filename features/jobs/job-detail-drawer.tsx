"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { StatusBadge } from "../../components/ui/status-badge";
import type { JobPosting, JobState } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";

export function JobDetailDrawer({
  job,
  onClose,
  onChangeState,
}: {
  job: JobPosting;
  onClose(): void;
  onChangeState(state: JobState): Promise<void>;
}): ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className="job-drawer" role="dialog" aria-modal="true" aria-label="Job details">
        <header>
          <div>
            <span>{job.company}</span>
            <h2>{job.title}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="Close job details" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="drawer-body">
          <div className="job-state-line">
            <StatusBadge status={job.status} />
            <span>{job.location} · {job.arrangement}</span>
          </div>

          <section>
            <h3>Role snapshot</h3>
            <p>{job.summary}</p>
          </section>

          <section>
            <h3>Why it matched</h3>
            <div className="term-list">
              {job.matchedTerms.map((term) => <span key={term}>{term}</span>)}
            </div>
            <div className="score-line"><span>Relevance score</span><strong>{job.matchScore}%</strong></div>
          </section>

          <section className="timeline-block">
            <h3>Lifecycle</h3>
            <dl>
              <div><dt>First seen</dt><dd>{formatDateTime(job.firstSeenAt)}</dd></div>
              <div><dt>Last confirmed</dt><dd>{formatDateTime(job.lastConfirmedAt)}</dd></div>
            </dl>
          </section>

          <a className="official-link" href={job.officialUrl} target="_blank" rel="noreferrer">
            Open official job page <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={() => onChangeState("saved")}>Save</button>
          <button className="button secondary danger-text" type="button" onClick={() => onChangeState("hidden")}>Hide</button>
          <button className="button primary" type="button" onClick={() => onChangeState("applied")}>Mark applied</button>
        </footer>
      </aside>
    </div>
  );
}
