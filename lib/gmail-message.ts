export interface DigestJob {
  company: string;
  title: string;
  location: string;
  timing: string;
  score: number;
  reasons: string[];
  officialUrl: string;
}

export interface GmailMessageInput {
  from: string;
  to: string;
  subject: string;
  jobs: DigestJob[];
  siteUrl: string;
  testOnly?: boolean;
}

const cleanHeader = (value: string): string => {
  if (/[\r\n]/.test(value)) throw new Error("Gmail header values cannot contain line breaks.");
  return value.trim();
};

const assertHttpUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Gmail links must use HTTP or HTTPS.");
  return url.toString();
};

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const base64Url = (bytes: Uint8Array): string => bytesToBase64(bytes)
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/, "");

const encodeHeader = (value: string): string => `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(cleanHeader(value)))}?=`;

const validated = (input: GmailMessageInput) => ({
  ...input,
  from: cleanHeader(input.from),
  to: cleanHeader(input.to),
  subject: cleanHeader(input.subject),
  siteUrl: assertHttpUrl(input.siteUrl),
  jobs: input.jobs.map((job) => ({ ...job, officialUrl: assertHttpUrl(job.officialUrl), reasons: job.reasons.slice(0, 4) })),
});

const renderPlainText = (input: ReturnType<typeof validated>): string => [
  input.testOnly ? "Job Pulse Gmail connection test" : `${input.jobs.length} new resume match${input.jobs.length === 1 ? "" : "es"}`,
  "",
  ...input.jobs.flatMap((job, index) => [
    `${index + 1}. ${job.company} — ${job.title}`,
    `${job.location} · ${job.timing} · ${job.score}% match`,
    ...(job.reasons.length ? [`Why: ${job.reasons.join(" · ")}`] : []),
    job.officialUrl,
    "",
  ]),
  `View all matches: ${input.siteUrl}`,
].join("\r\n");

const renderHtml = (input: ReturnType<typeof validated>): string => `<!doctype html>
<html lang="en"><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(input.testOnly ? "Job Pulse Gmail connection test" : `${input.jobs.length} new resume match${input.jobs.length === 1 ? "" : "es"}`)}</h1>
${input.jobs.map((job) => `<article style="border:1px solid #dbeafe;border-radius:12px;padding:14px;margin:12px 0">
<strong>${escapeHtml(job.company)} — ${escapeHtml(job.title)}</strong>
<div>${escapeHtml(job.location)} · ${escapeHtml(job.timing)} · ${job.score}% match</div>
${job.reasons.length ? `<div>Why: ${job.reasons.map(escapeHtml).join(" · ")}</div>` : ""}
<a href="${escapeHtml(job.officialUrl)}">Open official posting</a>
</article>`).join("")}
<p><a href="${escapeHtml(input.siteUrl)}">View all matches in Job Pulse</a></p>
</body></html>`;

export const buildGmailRawMessage = (rawInput: GmailMessageInput): string => {
  const input = validated(rawInput);
  const boundary = "job-pulse-resume-v1";
  const headers = [
    `From: Job Pulse <${input.from}>`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Language: en",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const mime = [
    ...headers, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "",
    renderPlainText(input), `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "",
    renderHtml(input), `--${boundary}--`, "",
  ].join("\r\n");
  return base64Url(new TextEncoder().encode(mime));
};
