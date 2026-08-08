"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { CompanyLogo } from "../../components/ui/company-logo";
import type { TalentTarget } from "../../lib/domain";
import { useRepositoryQuery } from "../../lib/use-repository-query";

function capabilityLabel(value: TalentTarget["resumeUpload"] | TalentTarget["jobAlerts"]): string {
  if (value === "available") return "Available";
  if (value === "job_only") return "Job applications only";
  return "Unknown";
}

export function TalentScreen(): ReactElement {
  const { repository, revision } = useJobPulse();
  const query = useRepositoryQuery(() => repository.listTalentTargets(), [revision]);
  const targets = query.data ?? [];

  return (
    <div className="page-stack talent-page">
      <header className="page-heading">
        <div><h1>Talent Harness</h1><p>A verified directory of official Talent Community pages, resume support, and job-alert capabilities.</p></div>
        <div className="safety-note"><ShieldCheck size={17} aria-hidden="true" /><div><strong>Provider only</strong><span>Nothing runs inside Job Pulse</span></div></div>
      </header>

      <section className="harness-explainer surface" aria-label="How Talent Harness works">
        <ShieldCheck size={20} aria-hidden="true" />
        <div><strong>Use it as a launchpad</strong><p>Job Pulse opens the official page and provides a checklist. Registration, CAPTCHA, SMS, custom questions, uploads, and final submission stay on the employer&apos;s site.</p></div>
      </section>

      <section className="surface talent-surface">
        <div className="section-heading"><div><h2>Verified Talent directory</h2><p>{targets.length} official Talent endpoints in view.</p></div><span className="demo-note">Links · capabilities · guidance</span></div>
        {query.loading ? <LoadingState label="Loading Talent queue" /> : null}
        {query.error ? <ErrorState retry={query.retry} /> : null}
        {!query.loading && !query.error && targets.length === 0 ? <EmptyState title="No Talent targets in this state" /> : null}
        {!query.loading && !query.error && targets.length ? (
          <div className="talent-list">
            {targets.map((target) => (
              <article className="talent-row" key={target.id}>
                <CompanyLogo company={target.company} large />
                <div className="talent-company"><strong>{target.company}</strong><span>{target.ats} · Official endpoint</span></div>
                <dl className="capability-list"><div><dt>Resume</dt><dd>{capabilityLabel(target.resumeUpload)}</dd></div><div><dt>Job alerts</dt><dd>{capabilityLabel(target.jobAlerts)}</dd></div></dl>
                <div className="talent-actions">
                  <a className="button secondary official-talent-button" href={target.talentUrl} target="_blank" rel="noreferrer" aria-label={`Open ${target.company} official Talent page`}><ExternalLink size={16} aria-hidden="true" />Open official page</a>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
