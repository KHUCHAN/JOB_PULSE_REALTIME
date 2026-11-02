// Adapt archived transport in memory; never edit its verified original bytes.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../review-runtime');
let source=await fs.readFile(path.join(runtime,'dispatch-verified.mjs'),'utf8');
const marker="const insert='process.argv[2]=stamp;'";
if(!source.includes(marker))throw Error('Archived dispatch adapter changed');
source=source.replace(marker,"const insert='process.argv[2]=stamp;'");
// This hook runs after the archived wrapper's API validation transformations.
const hook="if(checkOnly){";
if(!source.includes(hook))throw Error('Archived dispatch check marker missing');
source=source.replace(hook,`code="import {patchDispatchBody} from '${new URL('./dispatch-policy.mjs',import.meta.url).href}';\\n"+code;code=code.replace('process.argv[2]=stamp;','code=patchDispatchBody(code);\\nprocess.argv[2]=stamp;');\n`+hook);
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
