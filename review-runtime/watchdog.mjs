import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {checkWatchdog} from './run-status.mjs';
const root=path.join(os.homedir(),'Library/Application Support/Job Pulse/runtime-root');
let auth;try{auth=JSON.parse(await fs.readFile(path.join(root,'live-authorization.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
if(auth){let rollback=false;try{await fs.access(path.join(root,'rollback-completed.json'));rollback=true;}catch{}
 if(!rollback)console.log(JSON.stringify(await checkWatchdog({activatedAt:new Date(auth.at*1000).toISOString()})));
}
