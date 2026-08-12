import { runDueCrawls } from "../lib/crawl-runner";
import { D1CrawlStore } from "./crawl-store";
import { processDueResumeAlerts, type GmailRuntimeConfig } from "../lib/resume-alert-service";

interface CrawlerEnv {
  DB: D1Database;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER?: string;
}

const gmailConfig = (env: CrawlerEnv): GmailRuntimeConfig | null => {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER) return null;
  return {
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    sender: env.GMAIL_SENDER,
    siteUrl: "https://job-pulse-realtime.autodev61.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
  };
};

export default {
  async fetch(): Promise<Response> {
    return new Response("Job Pulse crawler is scheduled every two hours.", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: CrawlerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const now = new Date(event.scheduledTime);
      await runDueCrawls(new D1CrawlStore(env.DB), fetch, now, {
        concurrency: 8,
        limit: 1_500,
      });
      await processDueResumeAlerts(env.DB, gmailConfig(env), now);
    })());
  },
};
