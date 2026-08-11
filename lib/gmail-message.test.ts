import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildGmailRawMessage } from "./gmail-message";

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
      }],
      siteUrl: "https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
    }));

    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain("Machine Learning Intern");
    expect(raw).toContain("&amp;");
    expect(raw).not.toContain("(213) 598-7426");
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
