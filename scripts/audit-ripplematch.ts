// @ts-expect-error jsdom is an audit-only runtime dependency without bundled declarations.
import { JSDOM } from "jsdom";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? "output/ripplematch-audit.json");
const site = "https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse";
async function json(url: string): Promise<any> {
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); }
  catch { r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); }
  if (r.status === 429) {
    const delay = Number(r.headers.get("retry-after") ?? 60);
    await new Promise(resolve => setTimeout(resolve, Math.max(60, delay) * 1000));
    r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const html = await fetch("https://ripplematch.com/jobs/data-science-majors/", { signal: AbortSignal.timeout(30_000) });
if (!html.ok) throw new Error(`RippleMatch listing HTTP ${html.status}`);
const doc = new JSDOM(await html.text()).window.document as Document;
let cards = [...doc.querySelectorAll("article")].flatMap(card => {
  const title = card.querySelector("h2")?.textContent?.trim();
  const href = card.querySelector<HTMLAnchorElement>('a[href*="/v2/public/job/"]')?.href;
  if (!title || !href) return [];
  return [{ title, url: href, company: card.querySelector('a[href*="/company/"]:not(:has(img))')?.textContent?.trim() ?? "",
    type: card.querySelector('[class*="topline"]')?.textContent?.trim(), id: href.split("/").pop()!, detail: null as any }];
});
if (!cards.length) throw new Error("RippleMatch listing schema changed: no cards");
cards = [...new Map(cards.map(card => [card.id, card])).values()];
if (process.argv.includes("--refresh-db")) cards = [...new Map(JSON.parse(await readFile(output, "utf8")).cards.map((c: any) => [c.id, c])).values()] as typeof cards;
for (const card of process.argv.includes("--refresh-db") ? [] : cards) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  card.detail = await json(`https://app.ripplematch.com/api/public/jobs/${card.id}?source=rm`);
  const state = await json(`https://app.ripplematch.com/api/v2/direct-apply/${card.id}`);
  card.detail.applicationState = { isDisabledRole: state.isDisabledRole, roleUuid: state.roleUuid,
    overview: state.overview, company: state.publicCompanyDetails, roleLocationsList: state.roleLocationsList };
}
const inventories: Record<string, any> = {};
const aliases: Record<string, string[]> = { Abbott: ["Abbott Laboratories"], Epic: ["Epic Systems"], Moodys: ["Moody's", "Moody's Analytics"], "Guardian Life Insurance": ["Guardian Life"], PNC: ["PNC Financial Services"], MKS: ["MKS Instruments"] };
for (const company of [...new Set(cards.map(c => c.company))]) {
  const rows: any[] = [];
  let snapshotAt: string | undefined;
  let total = 0;
  for (let page = 1; page <= 30; page++) {
    const p = new URLSearchParams({ resource: "jobs", page: String(page), pageSize: "100" });
    for (const alias of aliases[company] ?? [company]) p.append("company", alias);
    if (snapshotAt) p.set("snapshotAt", snapshotAt);
    const result = await json(`${site}?${p}`);
    snapshotAt ??= result.snapshotAt;
    total = result.total;
    const jobs = result.jobs ?? result.items;
    if (!Array.isArray(jobs)) throw new Error(`Unknown DB jobs schema: ${Object.keys(result)}`);
    rows.push(...jobs);
    if (jobs.length < 100 || rows.length >= total) break;
  }
  inventories[company] = { snapshotAt, total, rows, complete: rows.length >= total };
  console.log(company, rows.length, total);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), cards, inventories }, null, 2));
}
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), cards, inventories }, null, 2));
console.log(`Saved ${cards.length} cards to ${output}`);
