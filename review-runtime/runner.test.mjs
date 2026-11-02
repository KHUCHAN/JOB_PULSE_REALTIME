import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {exceptionForRow} from './exception-run.mjs';
test('shadow transport and original durable writes fail before any effect',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'job-pulse-guard-test-')),out=path.join(root,'evidence');mkdirSync(out);mkdirSync(path.join(root,'.codex_tmp'));
 const state=path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json');writeFileSync(state,'{"fixture":true}');
 const script=`const fs=require('node:fs'); const fsp=require('node:fs/promises'); (async()=>{let n=0;for(const f of [()=>fs.writeFileSync(${JSON.stringify(state)},'bad'),()=>fsp.writeFile(${JSON.stringify(state)},'bad'),()=>fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse',{method:'POST',body:'{}'})]){try{await f()}catch{n++}}if(n!==3)process.exit(2)})();`;
 const result=spawnSync(process.execPath,['--require',path.resolve('review-runtime/shadow-guard.cjs'),'-e',script],{env:{...process.env,JOB_PULSE_PROJECT_ROOT:root,JOB_PULSE_SHADOW_OUTPUT:out},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(state,'utf8'),'{"fixture":true}');
});
test('exception bounds hold the sixth row and oversize input without calling CLI',async()=>{
 assert.equal((await exceptionForRow({id:'1'},'','',{calls:5})).decision,'hold');
 assert.equal((await exceptionForRow({id:'1',title:'x'.repeat(10000)},'','',{calls:0})).decision,'hold');
});
