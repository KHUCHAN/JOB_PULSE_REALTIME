import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { crawlSource } from './crawler';

const source = { id: 'p4-0285-google', company: 'Google / Alphabet', postingUrl: 'https://www.google.com/about/careers/applications/jobs/results/', adapter: 'custom' as const, crawlPageCursor: 21 };
const card = (id: number, title = `Role ${id}`, location = 'Mountain View, CA, USA') => `<li class="lLd3Je" ssk='0:${id}'><h3>${title}</h3><span class="r0wTof">${location}</span><a href="/about/careers/applications/jobs/results/${id}-role?q=intern&amp;sort_by=date" aria-label="Learn more about ${title}"></a></li>`;
const page = (total: number, cards: string) => new Response(`<span class="SWhIm">${total}</span> jobs matched${cards}`);

it('keeps FAANG, Netflix and semiconductor recovery IDs enabled without truncation', () => {
  const workflow = readFileSync('.github/workflows/production-crawl.yml', 'utf8');
  for (const variable of ['REQUEST_FALLBACK_SOURCE_IDS', 'REQUEST_FALLBACK_FORCE_SOURCE_IDS']) {
    const ids = workflow.match(new RegExp(`${variable}: ([^\\n]+)`))![1].trim().split(',');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(64);
    for (const id of ['p4-0285-google', 'p4-0219-apple', 'p4-0308-meta', 'p4-0394-amazon', 'p4-0314-netflix', 'p4-0319-nvidia', 'p4-0309-microsoft', 'p5-0793-amd', 'p5-0947-intel', 'p5-0984-micron-technology', 'p5-1050-samsung-semiconductor', 'p5-1086-tsmc-arizona']) expect(ids).toContain(id);
  }
});

it('reads later newest-first internship pages without a year constraint and preserves identity-bound locations', async () => {
  const detailIds: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (/\/results\/\d/.test(url.pathname)) {
      detailIds.push(url.pathname);
      return new Response('', { status: 404 });
    }
    const n = Number(url.searchParams.get('page') ?? 1);
    const q = url.searchParams.get('q');
    if (q) expect(url.searchParams.get('sort_by')).toBe('date');
    if (q === 'co-op') return page(0, '');
    if (q === 'intern') return page(21, n === 1
      ? Array.from({ length: 20 }, (_, i) => card(1000 + i, `Software Intern ${i}`)).join('')
      : card(119184, 'Data Scientist, Product Intern, MS', 'Austin, TX, USA'));
    return page(421, Array.from({ length: n === 22 ? 1 : 20 }, (_, i) => card(n * 100 + i)).join(''));
  };
  const result = await crawlSource(source, fetcher, new Date('2026-09-14T12:00:00Z'));
  expect(result.status).toBe('succeeded');
  expect(result.pagination?.cycleComplete).toBe(true);
  expect(result.jobs[0].title).toBe('Software Intern 0');
  expect(result.jobs).toContainEqual(expect.objectContaining({ externalId: '119184', location: 'Austin, TX, USA', publishedAt: null, officialUrl: 'https://www.google.com/about/careers/applications/jobs/results/119184-role' }));
  expect(detailIds.some(id => id.includes('119184-role'))).toBe(true);
  expect(result.jobs.every(job => !job.officialUrl.includes('sort_by'))).toBe(true);
});

it('reports repeated or failed priority pages instead of healthy partial coverage', async () => {
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.searchParams.get('q')) return page(21, Array.from({ length: 20 }, (_, i) => card(1000 + i)).join(''));
    return page(421, Array.from({ length: 20 }, (_, i) => card(i)).join(''));
  };
  const result = await crawlSource(source, fetcher, new Date());
  expect(result.status).toBe('failed');
  expect(result.completeListing).toBe(false);
  expect(result.error).toContain('priority intern page 2 failed or repeated');
});

it('enriches Arm internships from official structured dates and locations', async () => {
  const officialUrl = 'https://careers.arm.com/job/trondheim/graphics-software-intern/33099/100604944240';
  const fetcher: typeof fetch = async input => {
    if (String(input) === officialUrl) return new Response(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Graphics Software Intern', url: officialUrl, identifier: { value: '100604944240' }, datePosted: '2026-9-14', description: 'C++ and Vulkan software internship. '.repeat(10), jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Trondheim', addressCountry: 'NO' } } })}</script>`);
    return new Response(`<a href="${officialUrl}">Graphics Software Intern</a>`);
  };
  const result = await crawlSource({ id: 'p5-0804-arm', company: 'Arm', adapter: 'custom', postingUrl: 'https://careers.arm.com/search-jobs' }, fetcher, new Date());
  expect(result.jobs).toContainEqual(expect.objectContaining({ title: 'Graphics Software Intern', location: expect.stringContaining('Trondheim'), publishedAt: '2026-09-14T00:00:00.000Z' }));
});

it('uses the employer-linked active Renesas ATS rather than expired sitemap vacancies', async () => {
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    expect(url.hostname).toBe('api.smartrecruiters.com');
    const record = { id: '744000149335200', name: 'Intern, Test Engineering', refNumber: '20032573_2026-09-14', releasedDate: '2026-09-14T13:26:57.574Z', company: { identifier: 'RenesasElectronics', name: 'Renesas Electronics' }, location: { city: 'San Jose', region: 'California', country: 'us' }, ref: 'https://api.smartrecruiters.com/v1/companies/RenesasElectronics/postings/744000149335200', typeOfEmployment: { label: 'Intern' } };
    if (url.pathname.endsWith('/744000149335200')) return Response.json({ ...record, active: true, jobAd: { sections: { jobDescription: { text: 'Python and automated semiconductor testing. '.repeat(5) } } } });
    return Response.json({ totalFound: 1, content: [record], offset: 0, limit: 100 });
  };
  const result = await crawlSource({ id: 'p5-1038-renesas', company: 'Renesas', adapter: 'custom', postingUrl: 'https://jobs.renesas.com/jobs' }, fetcher, new Date());
  expect(result.status).toBe('succeeded');
  expect(result.completeListing).toBe(true);
  expect(result.resolvedListingUrl).toBe('https://careers.smartrecruiters.com/RenesasElectronics');
  expect(result.jobs).toContainEqual(expect.objectContaining({ title: 'Intern, Test Engineering', locationCountry: 'us', publishedAt: '2026-09-14T13:26:57.574Z', officialUrl: expect.stringContaining('jobs.smartrecruiters.com/RenesasElectronics/') }));
});
