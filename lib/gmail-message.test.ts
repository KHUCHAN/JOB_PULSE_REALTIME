import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildGmailRawMessage } from "./gmail-message";
import type { PlatformLead } from "./platform-leads";

const decodeBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

describe("Gmail digest MIME", () => {
  it("builds a safe multipart digest with official links and no resume PII", () => {
    const raw = decodeBase64Url(buildGmailRawMessage({
      from: "kimchany@usc.edu",
      to: "lupeter@usc.edu",
      subject: "[Job Pulse] New resume matches: 1",
      jobs: [{
        company: "Acme",
        title: "Machine Learning Intern",
        location: "Los Angeles, CA",
        timing: "Posted Aug 10, 2026",
        score: 92,
        reasons: ["Machine Learning", "Python"],
        officialUrl: "https://jobs.example/apply?id=1&source=pulse",
        program: "Co-op",
        scheduleNote: "Work-term dates not stated; verify possible semester overlap",
      }],
      siteUrl: "https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
    }));

    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain("Content-Language: en");
    expect(raw).toContain('<html lang="en">');
    expect(raw).toContain("Machine Learning Intern");
    expect(raw).toContain("Program: Co-op");
    expect(raw).toContain("verify possible semester overlap");
    expect(raw).toContain("&amp;");
    expect(raw).not.toContain("(213) 598-7426");
  });

  it("puts all digest recipients on one MIME message", () => {
    const raw = decodeBase64Url(buildGmailRawMessage({
      from: "kimchany@usc.edu",
      to: "kimchany@usc.edu, lupeter@usc.edu",
      subject: "Digest",
      jobs: [],
      siteUrl: "https://example.com/jobs",
    }));

    expect(raw).toContain("To: kimchany@usc.edu, lupeter@usc.edu");
  });

  it("rejects header injection and unsafe official links", () => {
    const valid = {
      from: "kimchany@usc.edu",
      to: "lupeter@usc.edu",
      subject: "Digest",
      jobs: [{ company: "Acme", title: "Intern", location: "US", timing: "Today", score: 80, reasons: [], officialUrl: "javascript:alert(1)" }],
      siteUrl: "https://example.com/jobs",
    };
    expect(() => buildGmailRawMessage({ ...valid, subject: "Digest\r\nBcc: attacker@example.com" })).toThrow("header");
    expect(() => buildGmailRawMessage(valid)).toThrow("HTTP");
  });
});

describe("platform lead section", () => {
  const decode = (value: string) => Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
  const message = (platformLeads?: PlatformLead[]) => decode(buildGmailRawMessage({
    from: "a@example.com", to: "b@example.com", subject: "Digest", siteUrl: "https://example.com",
    jobs: [{ company: "Acme", title: "Intern", location: "Austin, TX", timing: "Posted 2026-11-03", score: 90, reasons: [], officialUrl: "https://acme.com/1" }],
    platformLeads,
  }));
  it("labels the rows, escapes them and links to the platform in both parts", () => {
    const raw = message([{ platform: "LinkedIn", company: "A<b>", title: "ML Intern", location: "Austin, TX", firstSeen: "2026-11-03", url: "https://www.linkedin.com/jobs/view/1" }]);
    expect(raw).toContain("Also on Handshake and LinkedIn (1)");
    expect(raw).toContain("not checked against an official page");
    expect(raw).toContain("A&lt;b&gt;");
    expect(raw).toContain("Open on LinkedIn");
    expect(raw).toContain("LinkedIn: https://www.linkedin.com/jobs/view/1");
  });
  it("adds nothing without rows", () => expect(message()).not.toContain("Also on Handshake"));
});
