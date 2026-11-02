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
test('every Desktop filesystem path and symlink alias fails synchronously',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'job-pulse-desktop-test-')),out=path.join(root,'evidence');mkdirSync(out);
 const desktop=path.join(os.homedir(),'Desktop'),alias=path.join(root,'desktop-alias');
 const setup=spawnSync('/bin/ln',['-s',desktop,alias]);assert.equal(setup.status,0);
 const script=`const fs=require('node:fs'),fsp=require('node:fs/promises');const direct=${JSON.stringify(desktop+'/never-read')},alias=${JSON.stringify(alias+'/never-read')};(async()=>{let denied=0;for(const p of [direct,alias,new URL('file://'+direct),Buffer.from(direct)])for(const action of [()=>fs.statSync(p),()=>fs.readFileSync(p),()=>fsp.readFile(p),()=>fs.openSync(p,'r'),()=>fsp.readdir(p),()=>fs.createReadStream(p),()=>fs.writeFileSync(p,'x')])try{await action()}catch(e){if(/Desktop.*denied/.test(e.message))denied++;else throw e;}if(denied!==28)throw Error('not all denied '+denied);})();`;
 const child=spawnSync(process.execPath,['--require',path.resolve('review-runtime/desktop-guard.cjs'),'-e',script],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
});
test('missing snapshot holds before a shadow can read a legacy project',()=>{
 const base=mkdtempSync(path.join(os.tmpdir(),'job-pulse-missing-snapshot-')),runtime=path.join(base,'review-runtime');mkdirSync(runtime);
 const child=spawnSync(process.execPath,[path.resolve('review-runtime/review-run.mjs')],{env:{...process.env,JOB_PULSE_RUNTIME:runtime},encoding:'utf8'});
 assert.equal(child.status,1);assert.equal(JSON.parse(child.stdout).status,'hold-snapshot-missing-or-invalid');assert.equal(JSON.parse(child.stdout).posts,0);
});
