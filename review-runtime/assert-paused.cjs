const {execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path'),fs=require('node:fs/promises');
exports.assertPaused=async()=>{const c=require('./live-config.cjs');if(c.rehearsal){if(JSON.parse(await fs.readFile(path.join(c.base,'automation.json'))).status!=='PAUSED')throw Error('Legacy automation is not PAUSED');return;}
 await promisify(execFile)('/usr/local/bin/python3',[path.join(__dirname,'transition.py'),'assert-paused'],{timeout:30000});};
