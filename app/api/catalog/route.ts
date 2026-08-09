import { and, asc, count, isNotNull, like, sql } from "drizzle-orm";
import catalogSeed from "../../../db/seed/sources.json";
import { getDb } from "../../../db";
import { sources } from "../../../db/schema";
import { ensureCatalogSeeded, type CatalogSeed } from "../../../lib/catalog-bootstrap";
import { parseCatalogQuery } from "../../../lib/catalog-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const input = parseCatalogQuery(new URL(request.url));
  const filters = [
    input.query ? like(sources.company, `%${input.query}%`) : undefined,
    input.talentOnly ? isNotNull(sources.talentUrl) : undefined,
  ].filter((filter) => filter !== undefined);
  const where = filters.length ? and(...filters) : undefined;
  const db = getDb();
  await ensureCatalogSeeded((db as unknown as { $client: D1Database }).$client, catalogSeed as CatalogSeed);

  const pageQuery = db
    .select({
      id: sources.id,
      company: sources.company,
      postingUrl: sources.postingUrl,
      talentUrl: sources.talentUrl,
      adapter: sources.adapter,
      verification: sources.verification,
      confidence: sources.confidence,
      resumeUpload: sources.resumeUpload,
      jobAlerts: sources.jobAlerts,
      checkedAt: sources.checkedAt,
      enabled: sources.enabled,
    })
    .from(sources)
    .where(where)
    .orderBy(asc(sources.company))
    .limit(input.limit)
    .offset(input.offset);

  const summaryQuery = db
    .select({
      total: count(),
      postingUrls: sql<number>`coalesce(sum(case when ${sources.postingUrl} is not null then 1 else 0 end), 0)`,
      talentUrls: sql<number>`coalesce(sum(case when ${sources.talentUrl} is not null then 1 else 0 end), 0)`,
      enabled: sql<number>`coalesce(sum(case when ${sources.enabled} = 1 then 1 else 0 end), 0)`,
    })
    .from(sources)
    .where(where);

  const [items, summaryRows] = await db.batch([pageQuery, summaryQuery]);
  const summary = summaryRows[0] ?? { total: 0, postingUrls: 0, talentUrls: 0, enabled: 0 };

  return Response.json(
    { items, summary, pagination: { limit: input.limit, offset: input.offset } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
