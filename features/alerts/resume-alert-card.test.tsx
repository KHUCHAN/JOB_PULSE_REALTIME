import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ResumeAlertStatus } from "../../lib/domain";
import { ResumeAlertCard } from "./resume-alert-card";

const connectedStatus: ResumeAlertStatus = {
  profileId: "chanyoung-resume",
  enabled: true,
  gmailState: "connected",
  sender: "kimchany@usc.edu",
  recipients: ["kimchany@usc.edu", "lupeter@usc.edu"],
  queuedJobs: 3,
  lastDigestAt: null,
  nextDigestAt: "2026-08-10T14:00:00.000Z",
  lastError: null,
};

it("shows both recipients and sends a connection test", async () => {
  const user = userEvent.setup();
  const sendTest = vi.fn(async () => undefined);
  render(<ResumeAlertCard status={connectedStatus} onToggle={vi.fn()} onTest={sendTest} onRetry={vi.fn()} />);

  expect(screen.getAllByText("kimchany@usc.edu").length).toBeGreaterThan(0);
  expect(screen.getByText("lupeter@usc.edu")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send test email" }));
  expect(sendTest).toHaveBeenCalledTimes(1);
});

it("prevents activation while Gmail is unconfigured", () => {
  render(<ResumeAlertCard
    status={{ ...connectedStatus, enabled: false, gmailState: "unconfigured" }}
    onToggle={vi.fn()} onTest={vi.fn()} onRetry={vi.fn()}
  />);

  expect(screen.getByRole("switch", { name: "Enable resume match emails" })).toBeDisabled();
});
