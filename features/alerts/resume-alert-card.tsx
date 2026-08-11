"use client";

import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ResumeAlertStatus } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";

export function ResumeAlertCard({
  status,
  onToggle,
  onTest,
  onRetry,
}: {
  status: ResumeAlertStatus;
  onToggle(enabled: boolean): Promise<unknown>;
  onTest(): Promise<unknown>;
  onRetry(): Promise<unknown>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const act = async (label: string, callback: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await callback();
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The email action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface resume-alert-card" aria-labelledby="resume-alert-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Personal alert</span>
          <h2 id="resume-alert-title">Resume Match Gmail</h2>
          <p>New U.S. internship and co-op matches, checked every two hours.</p>
        </div>
        <span className={`gmail-state gmail-state-${status.gmailState}`}>
          {status.gmailState === "connected" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {status.gmailState === "connected" ? "Gmail connected" : status.gmailState === "blocked" ? "Reconnect required" : "Not configured"}
        </span>
      </div>

      <div className="resume-alert-grid">
        <div><span>Sender</span><strong>{status.sender || "Not configured"}</strong></div>
        <div><span>Recipients</span><div className="recipient-list">{status.recipients.map((recipient) => <strong key={recipient}>{recipient}</strong>)}</div></div>
        <div><span>Queued matches</span><strong>{status.queuedJobs}</strong></div>
        <div><span>Last digest</span><strong>{formatDateTime(status.lastDigestAt)}</strong></div>
        <div><span>Next digest</span><strong>{formatDateTime(status.nextDigestAt)}</strong></div>
      </div>

      {status.lastError ? <div className="inline-error" role="alert">{status.lastError}</div> : null}
      <div className="resume-alert-actions">
        <div className="resume-email-toggle">
          <span>Email digests</span>
          <button
            className={`toggle ${status.enabled ? "is-on" : ""}`}
            type="button"
            role="switch"
            aria-checked={status.enabled}
            aria-label="Enable resume match emails"
            disabled={busy || status.gmailState !== "connected"}
            onClick={() => void act(status.enabled ? "Email digests paused." : "Email digests enabled.", () => onToggle(!status.enabled))}
          ><span /></button>
        </div>
        <button className="button secondary" type="button" disabled={busy || status.gmailState !== "connected"} onClick={() => void act("Test email sent to both recipients.", onTest)}>
          <Send size={15} /> Send test email
        </button>
        {status.gmailState === "blocked" || status.lastError ? (
          <button className="button secondary" type="button" disabled={busy} onClick={() => void act("Email delivery retry scheduled.", onRetry)}>
            <RefreshCw size={15} /> Retry delivery
          </button>
        ) : null}
        <span className="resume-alert-mail-icon" aria-hidden="true"><Mail size={18} /></span>
      </div>
      {message ? <p className="inline-feedback" aria-live="polite">{message}</p> : null}
    </section>
  );
}
