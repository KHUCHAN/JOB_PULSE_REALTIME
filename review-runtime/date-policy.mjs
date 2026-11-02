// 2026-11-02 policy. No network or durable review/delivery writes.
export const WINDOW_MS = 72 * 3600000;
export function effectiveDate(row, officialDate, absenceVerified = false) {
  // Never mask an old or malformed official date with firstSeenAt.
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  if (present(officialDate)) return { date: officialDate, basis: 'official' };
  if (present(row.publishedAt)) {
    if (/posted\s+(?:today|yesterday|\d+\s+days?\s+ago)/i.test(row.sourcePostedText??'')) return { date: null, basis: 'relative-unverified' };
    return { date: row.publishedAt, basis: 'stored-official' };
  }
  if (!absenceVerified) return { date: null, basis: 'unverified' };
  return { date: row.firstSeenAt, basis: 'firstSeenAt', label: `게시일 미표기 · 수집일 ${String(row.firstSeenAt).slice(0,10)} 기준` };
}
export function recent(date, asOf) {
  const value = Date.parse(date), now = Date.parse(asOf);
  return Number.isFinite(value) && Number.isFinite(now) && value <= now && value >= now - WINDOW_MS;
}
export function undatedGuard(rows, sourceEpochs = {}) {
  const counts = new Map();
  for (const row of rows) if (!row.publishedAt) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1);
  return rows.map(row => {
    const epoch = sourceEpochs[row.sourceId];
    if (!row.publishedAt && epoch && Date.parse(row.firstSeenAt) <= Date.parse(epoch))
      return { id: row.id, action: 'baseline', reason: 'source addition, URL change or recovery inventory' };
    if (!row.publishedAt && counts.get(row.sourceId) > 20)
      return { id: row.id, action: 'hold', reason: 'more than 20 undated new rows from one source in this run' };
    return { id: row.id, action: 'candidate' };
  });
}

export function dateFromOfficial(row, date, evidence) {
  if (date || row.publishedAt) return effectiveDate(row,date,false);
  // A visible but unparsed/relative posting date is not proof of absence.
  const body=String(evidence?.html??evidence?.text??'');
  const hasUnparsedDate=/(?:datePosted|dateModified|posted[-_ ]?date|date published|posted on|posted \d+ (?:days?|hours?)|published on)/i.test(body);
  return effectiveDate(row,null,evidence?.status===200 && !hasUnparsedDate);
}
export function pendingEffectiveDate(record, row) {
  const official=record.rationale?.match(/Official date: (\d{4}-\d\d-\d\d(?:T[^ ]+)?)/)?.[1]?.replace(/\.$/,'');
  if(official)return official;
  // The date-only disclosure is a label, never the exact 72-hour timestamp.
  return record.rationale?.includes('게시일 미표기 · 수집일 ') ? row?.firstSeenAt??null : null;
}
