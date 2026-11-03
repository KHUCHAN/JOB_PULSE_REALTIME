const { setupBrowserRuntime } = await import(__CLIENT__);
const fs = await import('node:fs/promises');
const out = {status:'checked',at:new Date().toISOString(),pages:[],rows:[]};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const agent = await setupBrowserRuntime();
const chrome = await agent.browsers.get('chrome');
await chrome.nameSession('Job Pulse Handshake check');
let tab = await chrome.tabs.new();
try {
  outer: for (const q of __QUERIES__) for (let page = 1; page <= __PAGES__; page++) {
    const read = async () => {
      await tab.goto('https://usc.joinhandshake.com/job-search?query=' + encodeURIComponent(q) + '&sort=posted_date_desc&page=' + page + '&per_page=25');
      let d;
      for (let i = 0; i < 8; i++) {
        await sleep(1500);
        d = await tab.playwright.evaluate(() => {
          const list = document.querySelector('[role="region"][aria-label="Jobs List"]');
          return { list: !!list, url: location.href, sort: list?.querySelector('select[name="sort"]')?.value, cards: [...(list?.querySelectorAll('[data-hook^="job-result-card |"]') ?? [])].map(e => ({ id: e.getAttribute('data-hook').split('|')[1].trim(), lines: e.innerText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8) })) };
        });
        if (d.cards.length) break;
      }
      return d;
    };
    let d;
    // Chrome can detach the debugger from a tab; a fresh tab recovers it.
    try { d = await read(); } catch (e) {
      if (!/debugger|detached|unattached|target closed/i.test(String(e.message ?? e))) throw e;
      out.tabRetries = (out.tabRetries ?? 0) + 1;
      await tab.close().catch(() => {});
      await sleep(3000);
      tab = await chrome.tabs.new();
      d = await read();
    }
    if (!d.list) { out.status = 'unavailable'; out.reason = 'Jobs List not shown; login wall or challenge'; break outer; }
    if (d.sort !== 'posted_date_desc') { out.pages.push({ q, page, skipped: 'newest sort not verified' }); break; }
    out.rows.push(...d.cards.map(c => ({ ...c, query: q })));
    out.pages.push({ q, page, count: d.cards.length });
    if (d.cards.length < 25) break;
    await sleep(2000);
  }
} catch (e) { out.status = 'unavailable'; out.reason = String(e.message ?? e).slice(0, 200); }
await fs.writeFile(__OUT__, JSON.stringify(out));
await tab.close().catch(() => {});
nodeRepl.write(JSON.stringify({ status: out.status, rows: out.rows.length }));
