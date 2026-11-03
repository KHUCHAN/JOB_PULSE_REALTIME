import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const callers=(await Promise.all((await fs.readdir(dir)).filter(n=>/\.(mjs|py)$/.test(n)&&!n.includes('.test.')).map(async n=>[n,await fs.readFile(path.join(dir,n),'utf8')]))).filter(([,s])=>/JOB_PULSE_CODEX|'codex'|"codex"/.test(s)&&s.includes("'exec'"));
test('finds every script that starts Codex',()=>assert.deepEqual(callers.map(([n])=>n).sort(),['exception-run.mjs','handshake-run.mjs','platform-run.mjs']));
for(const [name,source] of callers)test(`${name} starts a fresh session with no memory`,()=>{
 for(const flag of ["'--ephemeral'","'--ignore-user-config'","'--disable','memories'","memories.use_memories=false"])assert.ok(source.includes(flag),flag);
 assert.ok(!/'resume'|'--last'|--session/.test(source));
});
