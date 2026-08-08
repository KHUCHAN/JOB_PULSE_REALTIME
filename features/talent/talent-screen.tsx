"use client";

import { ExternalLink, ShieldCheck, UserRoundSearch, X } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import type { TalentState, TalentTarget } from "../../lib/domain";
import { formatDateTime, titleCase } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";

const blockerOptions = {
  captcha: "CAPTCHA — user action required",
  sms: "SMS verification — user action required",
  custom_question: "Custom employer question — user answer required",
  final_submit: "Final submission — user approval required",
} as const;

type BlockerKey = keyof typeof blockerOptions;

function capabilityLabel(value: TalentTarget["resumeUpload"] | TalentTarget["jobAlerts"]): string {
  if (value === "available") return "Available";
  if (value === "job_only") return "Job applications only";
  return "Unknown";
}

export function TalentScreen(): ReactElement {
  const { repository, revision, mutate } = useJobPulse();
  const [state, setState] = useState<"all" | TalentState>("all");
  const [blockingTarget, setBlockingTarget] = useState<TalentTarget | null>(null);
  const [blockerKey, setBlockerKey] = useState<BlockerKey>("captcha");
  const [message, setMessage] = useState("");
  const query = useRepositoryQuery(() => repository.listTalentTargets(state), [revision, state]);
  const targets = query.data ?? [];

  const updateState = async (target: TalentTarget, nextState: TalentState) => {
    await mutate(() => repository.updateTalentState(target.id, nextState));
    setMessage(`Demo data · ${target.company} moved to ${titleCase(nextState)}.`);
  };

  const saveBlocker = async () => {
    if (!blockingTarget) return;
    await mutate(() => repository.updateTalentState(
      blockingTarget.id,
      "blocked",
      blockerOptions[blockerKey],
    ));
    setMessage(`Demo data · ${blockingTarget.company} paused for user action.`);
    setBlockingTarget(null);
  };

  return (
    <div className="page-stack talent-page">
      <header className="page-heading">
        <div><h1>Talent Harness</h1><p>Prepare reusable registration steps, then stop cleanly at CAPTCHA, SMS, custom questions, and final approval.</p></div>
        <div className="safety-note"><ShieldCheck size={17} aria-hidden="true" /><div><strong>User gates stay manual</strong><span>No automatic submission</span></div></div>
      </header>

      <section className="compact-filter surface" aria-label="Talent filters">
        <div className="filter-control">
          <label htmlFor="talent-state">Talent state</label>
          <select id="talent-state" value={state} onChange={(event) => setState(event.target.value as "all" | TalentState)}>
            <option value="all">All states</option><option value="ready">Ready</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option>
          </select>
        </div>
        <p>The harness records progress only. It does not upload a resume or submit a form in this frontend preview.</p>
      </section>

      {message ? <div className="inline-feedback" aria-live="polite">{message}</div> : null}

      {blockingTarget ? (
        <section className="blocker-editor surface" aria-label={`Block ${blockingTarget.company}`}>
          <div><UserRoundSearch size={20} aria-hidden="true" /><div><strong>Pause {blockingTarget.company}</strong><span>Choose the user-only gate that stopped the assisted flow.</span></div></div>
          <div className="filter-control blocker-control"><label htmlFor="blocker-reason">Blocker reason</label><select id="blocker-reason" value={blockerKey} onChange={(event) => setBlockerKey(event.target.value as BlockerKey)}>{Object.entries(blockerOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <button className="button primary" type="button" onClick={saveBlocker}>Save blocker</button>
          <button className="icon-button" type="button" aria-label="Cancel blocker" onClick={() => setBlockingTarget(null)}><X aria-hidden="true" /></button>
        </section>
      ) : null}

      <section className="surface talent-surface">
        <div className="section-heading"><div><h2>Registration queue</h2><p>{targets.length} verified Talent endpoints in view.</p></div><span className="demo-note">Assisted · never autonomous</span></div>
        {query.loading ? <LoadingState label="Loading Talent queue" /> : null}
        {query.error ? <ErrorState retry={query.retry} /> : null}
        {!query.loading && !query.error && targets.length === 0 ? <EmptyState title="No Talent targets in this state" /> : null}
        {!query.loading && !query.error && targets.length ? (
          <div className="talent-list">
            {targets.map((target) => (
              <article className="talent-row" key={target.id}>
                <span className="company-avatar large" aria-hidden="true">{target.company.slice(0, 1)}</span>
                <div className="talent-company"><strong>{target.company}</strong><span>{target.ats} · Last attempt {formatDateTime(target.lastAttemptAt)}</span></div>
                <dl className="capability-list"><div><dt>Resume</dt><dd>{capabilityLabel(target.resumeUpload)}</dd></div><div><dt>Job alerts</dt><dd>{capabilityLabel(target.jobAlerts)}</dd></div></dl>
                <div className="talent-state"><StatusBadge status={target.state} />{target.blocker ? <span>{target.blocker}</span> : <span>Clear to continue</span>}</div>
                <div className="talent-actions">
                  <a className="icon-button" href={target.talentUrl} target="_blank" rel="noreferrer" aria-label={`Open ${target.company} official Talent page`}><ExternalLink size={16} aria-hidden="true" /></a>
                  <button className="button secondary" type="button" aria-label={`Start ${target.company} assisted flow`} onClick={() => updateState(target, "in_progress")}>Start assisted flow</button>
                  <button className="button secondary" type="button" aria-label={`Mark ${target.company} completed`} onClick={() => updateState(target, "completed")}>Mark completed</button>
                  <button className="button secondary danger-text" type="button" aria-label={`Mark ${target.company} blocked`} onClick={() => setBlockingTarget(target)}>Mark blocked</button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
