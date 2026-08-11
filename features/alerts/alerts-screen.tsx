"use client";

import { BellRing, Check, Mail, Plus } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useJobPulse } from "../../components/fixture-provider";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import type { KeywordRule } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";
import { useRepositoryQuery } from "../../lib/use-repository-query";
import { ResumeAlertCard } from "./resume-alert-card";

const splitTerms = (value: string): string[] =>
  [...new Set(value.split(",").map((term) => term.trim()).filter(Boolean))];

export function AlertsScreen(): ReactElement {
  const { repository, revision, mutate, demoMode } = useJobPulse();
  const [name, setName] = useState("");
  const [includeTerms, setIncludeTerms] = useState("");
  const [excludeTerms, setExcludeTerms] = useState("");
  const [locations, setLocations] = useState("");
  const [mode, setMode] = useState<KeywordRule["mode"]>("six_hour");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const query = useRepositoryQuery(() => repository.listKeywords(), [revision]);
  const resumeQuery = useRepositoryQuery(() => repository.getResumeAlertStatus(), [revision]);
  const keywords = query.data ?? [];

  const submitRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const includes = splitTerms(includeTerms);
    if (!name.trim() || includes.length === 0) {
      setErrorMessage("Add a rule name and at least one include term.");
      setMessage("");
      return;
    }
    await mutate(() => repository.createKeyword({
      name: name.trim(),
      includeTerms: includes,
      excludeTerms: splitTerms(excludeTerms),
      locations: splitTerms(locations),
      mode,
    }));
    setName("");
    setIncludeTerms("");
    setExcludeTerms("");
    setLocations("");
    setErrorMessage("");
    setMessage(demoMode ? "Demo data · changes are stored only for this preview and are not persisted." : "Keyword rule saved to the live database.");
  };

  const toggleRule = async (rule: KeywordRule) => {
    await mutate(() => repository.setKeywordEnabled(rule.id, !rule.enabled));
    setMessage(demoMode ? "Demo data · changes are stored only for this preview and are not persisted." : "Keyword rule updated in the live database.");
  };

  return (
    <div className="page-stack alerts-page">
      <header className="page-heading">
        <div><h1>Alerts</h1><p>Turn the roles you care about into a small, explainable set of keyword rules.</p></div>
        <div className="delivery-target"><Mail size={15} aria-hidden="true" /><div><span>Email destination</span><strong>Configured during backend setup</strong></div></div>
      </header>

      {message ? <div className="inline-feedback" aria-live="polite"><Check size={15} aria-hidden="true" />{message}</div> : null}
      {errorMessage ? <div className="inline-error" role="alert">{errorMessage}</div> : null}

      {resumeQuery.loading ? <LoadingState label="Loading resume email status" /> : null}
      {resumeQuery.error ? <ErrorState retry={resumeQuery.retry} /> : null}
      {resumeQuery.data ? <ResumeAlertCard
        status={resumeQuery.data}
        onToggle={(enabled) => mutate(() => repository.setResumeAlertEnabled(enabled))}
        onTest={() => mutate(() => repository.sendResumeTestEmail())}
        onRetry={() => mutate(() => repository.retryResumeAlert())}
      /> : null}

      <div className="alerts-layout">
        <section className="surface rule-composer">
          <div className="section-heading"><div><h2>Add a keyword rule</h2><p>Comma-separate multiple terms or locations.</p></div><Plus size={18} aria-hidden="true" /></div>
          <form onSubmit={submitRule}>
            <div className="form-field"><label htmlFor="rule-name">Rule name</label><input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Trust analytics" /></div>
            <div className="form-field"><label htmlFor="include-terms">Include terms</label><textarea id="include-terms" value={includeTerms} onChange={(event) => setIncludeTerms(event.target.value)} placeholder="fraud, risk analytics, trust" rows={3} /></div>
            <div className="form-field"><label htmlFor="exclude-terms">Exclude terms</label><input id="exclude-terms" value={excludeTerms} onChange={(event) => setExcludeTerms(event.target.value)} placeholder="intern, contract" /></div>
            <div className="form-field"><label htmlFor="rule-locations">Locations</label><input id="rule-locations" value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Remote, New York" /></div>
            <fieldset className="delivery-mode"><legend>Delivery mode</legend><label htmlFor="mode-six-hour"><input id="mode-six-hour" aria-label="Every 6 hours" type="radio" name="mode" value="six_hour" checked={mode === "six_hour"} onChange={() => setMode("six_hour")} /><span><strong>Every 6 hours</strong><small>Best for active searches</small></span></label><label htmlFor="mode-daily"><input id="mode-daily" aria-label="Daily digest" type="radio" name="mode" value="daily_digest" checked={mode === "daily_digest"} onChange={() => setMode("daily_digest")} /><span><strong>Daily digest</strong><small>One concise review</small></span></label></fieldset>
            <button className="button primary full-button" type="submit"><Plus size={16} aria-hidden="true" />Add keyword rule</button>
          </form>
        </section>

        <section className="surface rules-surface">
          <div className="section-heading"><div><h2>Keyword rules</h2><p>{keywords.filter((rule) => rule.enabled).length} enabled · {keywords.length} total</p></div><BellRing size={18} aria-hidden="true" /></div>
          {query.loading ? <LoadingState label="Loading alert rules" /> : null}
          {query.error ? <ErrorState retry={query.retry} /> : null}
          {!query.loading && !query.error && keywords.length === 0 ? <EmptyState title="No alert rules yet" /> : null}
          {!query.loading && !query.error && keywords.length ? (
            <div className="rules-list">
              {keywords.map((rule) => (
                <article className={`rule-row ${rule.enabled ? "" : "is-disabled"}`} key={rule.id}>
                  <div className="rule-main">
                    <div className="rule-title-line"><strong>{rule.name}</strong><span>{rule.mode === "six_hour" ? "Every 6 hours" : "Daily digest"}</span></div>
                    <div className="term-list compact-terms">{rule.includeTerms.map((term) => <span key={term}>{term}</span>)}</div>
                    {rule.excludeTerms.length ? <p>Excludes {rule.excludeTerms.join(", ")}</p> : <p>No exclusions</p>}
                  </div>
                  <div className="rule-delivery"><span>Last delivery</span><strong>{formatDateTime(rule.lastSentAt)}</strong></div>
                  <button className={`toggle ${rule.enabled ? "is-on" : ""}`} type="button" role="switch" aria-checked={rule.enabled} aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`} onClick={() => toggleRule(rule)}><span /></button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
