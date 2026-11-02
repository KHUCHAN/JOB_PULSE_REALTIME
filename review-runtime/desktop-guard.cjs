// Loaded before the legacy preload in every review child. No Desktop I/O,
// including stat/access/streams, URL/Buffer paths, or symlink aliases.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{fileURLToPath}=require('node:url');
const desktop=path.join(require('node:os').homedir(),'Desktop');
const real=fs.realpathSync.native.bind(fs.realpathSync),stat=fs.lstatSync.bind(fs);
function deny(value){
 if(typeof value==='number'||value==null)return;
 const raw=value instanceof URL?fileURLToPath(value):Buffer.isBuffer(value)?value.toString():String(value);
 const resolved=path.resolve(raw);let probe=resolved;
 const blocked=p=>p===desktop||p.startsWith(desktop+path.sep);
 if(blocked(resolved))throw Error('Desktop access denied: '+resolved);
 for(;;){try{stat(probe);break;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=path.dirname(probe);if(parent===probe)break;probe=parent;}}
 if(blocked(real(probe)))throw Error('Desktop symlink access denied: '+resolved);
}
const one=['readFile','writeFile','appendFile','open','stat','lstat','access','readdir','opendir','realpath','readlink','mkdir','rm','rmdir','unlink','truncate','chmod','chown','utimes','watch','watchFile','unwatchFile','createReadStream','createWriteStream','exists'];
const two=['copyFile','cp','rename','link','symlink'];
for(const api of [fs,fsp])for(const [names,count] of [[one,1],[two,2]])for(const name of names)for(const key of [name,name+'Sync']){
 if(typeof api[key]!=='function')continue;const original=api[key].bind(api),native=api[key].native;
 api[key]=function(...args){for(let i=0;i<count;i++)deny(args[i]);return original(...args);};
 if(native)api[key].native=function(...args){deny(args[0]);return native(...args);};
}
require('node:module').syncBuiltinESMExports();
module.exports={deny};
