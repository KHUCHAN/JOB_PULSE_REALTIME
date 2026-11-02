import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [project,runtime,stamp]=process.argv.slice(2),root=pathToFileURL(project+'/.codex_tmp/');
let code=await fs.readFile(new URL('heartbeat-20260910T073856-prepare.mjs',root),'utf8');
code=code.replaceAll("from './strict-official-recency.mjs'","from '"+new URL('strict-official-recency.mjs',root).href+"'")
 .replaceAll("from './greenhouse-official-evidence.mjs'","from '"+new URL('greenhouse-official-evidence.mjs',root).href+"'")
 .replaceAll("new URL('./worktrees/repair-all-20260831/","new URL('"+new URL('worktrees/repair-all-20260831/',root).href)
 .replace("const base=new URL('./',import.meta.url)","const base=new URL('"+root.href+"')")
 .replace('microdata(e)??(g?','e?.apiDerivedPosting??microdata(e)??(g?')
 .replace('if(rationale.length>2000)','if(rationale.length>10000)')
 .replace('(!!g||[j.officialUrl,j.applyUrl]','(!!g||!!e?.verifiedCanonicalRedirect||[j.officialUrl,j.applyUrl]')
 .replace("verifiedUrl:decision==='approve'&&!g?e.url:j.officialUrl","verifiedUrl:decision==='approve'&&!g&&!e?.verifiedCanonicalRedirect?e.url:j.officialUrl");
process.env.JOB_PULSE_RUN_STAMP=stamp;
await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
