const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'data');
const FILE = path.join(ROOT, 'jobs.json');
function ensure(){ if(!fs.existsSync(ROOT)) fs.mkdirSync(ROOT,{recursive:true}); if(!fs.existsSync(FILE)) fs.writeFileSync(FILE,'[]'); }
function read(){ ensure(); try{return JSON.parse(fs.readFileSync(FILE,'utf8')||'[]')}catch{return []} }
function write(v){ ensure(); const tmp=FILE+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(v,null,2)); fs.renameSync(tmp,FILE); }
function create(type,payload={},maxAttempts=3){ const jobs=read(); const now=new Date().toISOString(); const j={id:'job_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),type,payload,status:'queued',progress:0,attempts:0,maxAttempts,createdAt:now,updatedAt:now}; jobs.push(j); write(jobs); return j; }
function claim(){ const jobs=read(); const j=jobs.find(x=>x.status==='queued' && (!x.nextRunAt || new Date(x.nextRunAt)<=new Date())); if(!j)return null; j.status='processing';j.attempts++;j.updatedAt=new Date().toISOString();write(jobs);return j; }
function update(id,patch){const jobs=read();const j=jobs.find(x=>x.id===id);if(!j)return null;Object.assign(j,patch,{updatedAt:new Date().toISOString()});write(jobs);return j;}
function list(limit=50){return read().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,limit)}
module.exports={create,claim,update,list,read};
