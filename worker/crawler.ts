import { runDueCrawls } from "../lib/crawl-runner";
import { D1CrawlStore } from "./crawl-store";

interface CrawlerEnv {
  DB: D1Database;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Job Pulse crawler is scheduled every two hours.", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: CrawlerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDueCrawls(new D1CrawlStore(env.DB), fetch, new Date(event.scheduledTime), {
      concurrency: 8,
      limit: 1_500,
    }));
  },
};
