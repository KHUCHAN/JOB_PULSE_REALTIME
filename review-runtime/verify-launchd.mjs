import './desktop-guard.cjs';
// Read-only launchd preflight. No credential value ever enters output.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),base=path.join(os.homedir(),'Library/Application Support/Job Pulse'),repo=path.join(base,'repo'),runtime=path.join(base,'review-runtime');
const report={at:new Date().toISOString(),posts:0,llmTokens:0,checks:[]};
try{
 const project=await fs.realpath(path.join(base,'runtime-root/current-snapshot'));
 const manifest=JSON.parse(await fs.readFile(path.join(project,'snapshot-manifest.json')));
 const {createHash}=await import('node:crypto');for(const entry of manifest.files){const data=await fs.readFile(path.join(project,entry.relative));if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('Snapshot mismatch '+entry.relative);}
 report.checks.push('snapshot-all-sha256');
 const auth=JSON.parse((await exec('gh',['api','user'],{timeout:30000})).stdout);report.githubLogin=auth.login;report.checks.push('github-auth-api-user');
 let hostFile='';try{hostFile=await fs.readFile(path.join(os.homedir(),'.config/gh/hosts.yml'),'utf8');}catch{}
 const authStatus=await exec('gh',['auth','status'],{timeout:30000});report.credentialSourceObserved=/\(keyring\)/.test(authStatus.stdout+authStatus.stderr)?'keyring':'unconfirmed';
 report.dispatchAuth=process.env.GH_TOKEN?'GH_TOKEN environment':process.env.GITHUB_TOKEN?'GITHUB_TOKEN environment':/oauth_token:/.test(hostFile)?'GitHub CLI hosts.yml credential':'GitHub CLI macOS Keychain credential';
 const remote=JSON.parse((await exec('gh',['api','repos/KHUCHAN/JOB_PULSE_REALTIME/contents/.github/workflows/production-crawl.yml?ref=main'],{timeout:30000})).stdout);if(remote.encoding!=='base64')throw Error('Workflow evidence missing');report.checks.push('remote-workflow-readable');
 const guard=await exec(process.execPath,[path.join(repo,'scripts/check-production-crawl.mjs')],{cwd:repo,timeout:180000,maxBuffer:16*1024*1024});report.crawlGuard=JSON.parse(guard.stdout);if(report.crawlGuard.reason==='github-rate-limited')throw Error('GitHub rate limit');report.checks.push('production-crawl-read-only');
 const env={...process.env,JOB_PULSE_PROJECT_ROOT:project,JOB_PULSE_SHADOW_OUTPUT:path.join(runtime,'launchd-preflight-output')};await fs.mkdir(env.JOB_PULSE_SHADOW_OUTPUT,{recursive:true});
 await exec(process.execPath,['--require',path.join(repo,'review-runtime/desktop-guard.cjs'),'--require',path.join(runtime,'preload.cjs'),'--require',path.join(repo,'review-runtime/shadow-guard.cjs'),path.join(runtime,'dispatch-verified.mjs'),project,'heartbeat-20990101T000000','check'],{env,timeout:30000});report.checks.push('dispatch-wrapper-syntax-with-preload');
 report.checks.push('credential-store-status-redacted');
 report.livePostAuth='Bearer token from runtime-root/.codex_tmp/review-inbox/.codex-review-token (copied only at cutover, mode 0600), validated by server CODEX_REVIEW_TOKEN; not tested';report.tokenCopied=false;report.status='passed';
}catch(error){report.status=/rate limit|HTTP 403|HTTP 429/i.test(String(error.stderr??'')+' '+error.message)?'hold-rate-limited':'hold-preflight';report.error=report.status==='hold-rate-limited'?'GitHub rate limited; no dispatch attempted':error.message;process.exitCode=1;}
await fs.writeFile(path.join(runtime,'round2-launchd-preflight.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
