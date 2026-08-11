"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { StatusBadge } from "../../components/ui/status-badge";
import type { JobState } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";
import type { RichJobPosting } from "../../lib/pulse-mappers";

export function JobDetailDrawer({
  job,
  onClose,
  onChangeState,
}: {
  job: RichJobPosting;
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
    <div className="drawer-backdrop">
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

          {job.resumeMatchScore !== null ? (
            <section className="resume-match-explanation">
              <h3>Why this matches</h3>
              <div className="term-list">
                {job.resumeMatchEvidence.map((term) => <span key={term}>{term}</span>)}
              </div>
              <div className="score-line"><span>Resume fit</span><strong>{job.resumeMatchScore}% Match</strong></div>
            </section>
          ) : (
            <section>
              <h3>Why it matched</h3>
              <div className="term-list">
                {job.matchedTerms.map((term) => <span key={term}>{term}</span>)}
              </div>
              <div className="score-line"><span>Relevance score</span><strong>{job.matchScore}%</strong></div>
            </section>
          )}

          <section className="timeline-block">
            <h3>Lifecycle</h3>
            <dl>
              <div><dt>First seen</dt><dd>{formatDateTime(job.firstSeenAt)}</dd></div>
              <div><dt>Last confirmed</dt><dd>{formatDateTime(job.lastConfirmedAt)}</dd></div>
            </dl>
          </section>

          {job.employmentType || job.department || job.jobFunction || job.skills.length || job.experienceLevel || job.experienceRequirements || job.salaryMin !== null || job.salaryMax !== null || job.publishedAt || job.sourcePostedText || job.languages.length ? (
            <section className="detail-facts">
              <h3>Role details</h3>
              <dl>
                {job.employmentType ? <div><dt>Employment type</dt><dd>{job.employmentType}</dd></div> : null}
                {job.department || job.jobFunction ? <div><dt>Department / function</dt><dd>{[job.department, job.jobFunction].filter(Boolean).join(" · ")}</dd></div> : null}
                {job.skills.length ? <div><dt>Skills</dt><dd>{job.skills.join(", ")}</dd></div> : null}
                {job.experienceLevel || job.experienceRequirements ? <div><dt>Experience</dt><dd>{[job.experienceLevel, job.experienceRequirements].filter(Boolean).join(" · ")}</dd></div> : null}
                {job.salaryMin !== null || job.salaryMax !== null ? <div><dt>Salary</dt><dd>{[job.salaryMin !== null ? `${job.salaryCurrency ?? ""} ${job.salaryMin.toLocaleString()}`.trim() : null, job.salaryMax !== null ? `${job.salaryCurrency ?? ""} ${job.salaryMax.toLocaleString()}`.trim() : null].filter(Boolean).join(" – ")}{job.salaryInterval ? ` / ${job.salaryInterval}` : ""}</dd></div> : null}
                {job.publishedAt || job.sourcePostedText ? <div><dt>Posting date</dt><dd>{job.publishedAt ? formatDateTime(job.publishedAt) : job.sourcePostedText}</dd></div> : null}
                {job.languages.length ? <div><dt>Languages</dt><dd>{job.languages.join(", ")}</dd></div> : null}
              </dl>
            </section>
          ) : null}

          <a className="official-link" href={job.applyUrl ?? job.officialUrl} target="_blank" rel="noreferrer">
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
