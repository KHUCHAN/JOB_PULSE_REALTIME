// Finished evidence retains its original paths; gzip bytes are read transparently.
const fs=require('node:fs'),fsp=require('node:fs/promises'),zlib=require('node:zlib');
const rawRead=fsp.readFile.bind(fsp),rawSync=fs.readFileSync.bind(fs);
const unpack=b=>b.length>2&&b[0]===31&&b[1]===139?zlib.gunzipSync(b):b;
const encoding=o=>typeof o==='string'?o:o?.encoding;
const rawOptions=o=>o&&typeof o==='object'?{...o,encoding:null}:undefined;
fsp.readFile=async(file,options)=>{const b=unpack(await rawRead(file,rawOptions(options))),e=encoding(options);return e?b.toString(e):b;};
fs.readFileSync=(file,options)=>{const b=unpack(rawSync(file,rawOptions(options))),e=encoding(options);return e?b.toString(e):b;};
require('node:module').syncBuiltinESMExports();
module.exports={rawRead,unpack};
