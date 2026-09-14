const fs=require('fs'),path=require('path'),cp=require('child_process');
const {claim,update,list}=require('./queue');
const POLL=Number(process.env.JOB_POLL_MS||1000); const MAX=Math.max(1,Number(process.env.WORKER_CONCURRENCY||1));
const DB=path.join(__dirname,'data','db.json');
function loadDb(){return JSON.parse(fs.readFileSync(DB,'utf8'));}
function saveDb(d){const tmp=DB+'.worker.tmp';fs.writeFileSync(tmp,JSON.stringify(d,null,2));fs.renameSync(tmp,DB);}
function videoFor(job){const d=loadDb(); const v=(d.videos||[]).find(x=>x.id===job.payload?.videoId); return {d,v};}
function markVideo(videoId,patch){try{const {d,v}=videoFor({payload:{videoId}});if(!v)return;Object.assign(v,patch);saveDb(d);}catch(e){console.error('Video status update:',e.message)}}
async function processJob(job){
  if(job.type!=='video-process') throw new Error('Unsupported job type: '+job.type);
  const {v}=videoFor(job); if(!v) throw new Error('Video not found: '+job.payload?.videoId);
  if(v.storageDriver!=='local') throw new Error('Automatic processing requires local source storage');
  const source=v.objectKey?path.join(__dirname,'uploads',v.objectKey):v.filePath;
  if(!source || !fs.existsSync(source)) throw new Error('Source media not found');
  const out=path.join(__dirname,'uploads','hls',v.id); fs.mkdirSync(out,{recursive:true});
  update(job.id,{stage:'starting',progress:1}); markVideo(v.id,{processingStatus:'processing',processingProgress:1,processingError:null,processingJobId:job.id});
  const child=cp.spawn(process.execPath,[path.join(__dirname,'scripts','process-video.js'),source,out],{env:process.env,stdio:['ignore','pipe','pipe']});
  let stderr=''; let buf='';
  child.stdout.on('data',chunk=>{buf+=chunk.toString();const lines=buf.split(/\r?\n/);buf=lines.pop()||'';for(const line of lines){if(line.startsWith('JOB_PROGRESS ')){try{const info=JSON.parse(line.slice(13));update(job.id,info);markVideo(v.id,{processingStatus:info.progress>=100?'processing':'processing',processingProgress:info.progress,processingStage:info.stage});}catch(_){}} else if(line.startsWith('{')){try{const info=JSON.parse(line);update(job.id,{outputDir:info.output,master:info.master,renditions:{'360p':{url:'/api/videos/'+v.id+'/hls/v0/index.m3u8'},'720p':{url:'/api/videos/'+v.id+'/hls/v1/index.m3u8'},'1080p':{url:'/api/videos/'+v.id+'/hls/v2/index.m3u8'}}});}catch(_){}}}});
  child.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(-4000)});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(stderr||'FFmpeg processing failed')))});
  const finished=new Date().toISOString();
  update(job.id,{progress:100,stage:'complete',status:'completed',completedAt:finished,hlsUrl:'/api/videos/'+v.id+'/hls/master.m3u8',renditions:{'360p':{url:'/api/videos/'+v.id+'/hls/v0/index.m3u8'},'720p':{url:'/api/videos/'+v.id+'/hls/v1/index.m3u8'},'1080p':{url:'/api/videos/'+v.id+'/hls/v2/index.m3u8'}}});
  markVideo(v.id,{processingStatus:'ready',processingProgress:100,processingStage:'complete',processingError:null,hlsUrl:'/api/videos/'+v.id+'/hls/master.m3u8',renditions:{'360p':{url:'/api/videos/'+v.id+'/hls/v0/index.m3u8'},'720p':{url:'/api/videos/'+v.id+'/hls/v1/index.m3u8'},'1080p':{url:'/api/videos/'+v.id+'/hls/v2/index.m3u8'}},processedAt:finished});
}
async function runOne(){const j=claim();if(!j)return false;try{await processJob(j);}catch(e){const retry=j.attempts<j.maxAttempts;const patch=retry?{status:'queued',error:e.message,nextRunAt:new Date(Date.now()+Math.min(120000,1000*2**j.attempts)).toISOString(),stage:'retrying'}:{status:'failed',error:e.message,failedAt:new Date().toISOString(),stage:'error'};update(j.id,patch);markVideo(j.payload?.videoId,{processingStatus:retry?'queued':'failed',processingError:e.message,processingProgress:retry?0:0,processingStage:patch.stage});}return true;}
async function main(){if(process.argv.includes('--retry-failed'))for(const j of list(500).filter(x=>x.status==='failed'))update(j.id,{status:'queued',progress:0,error:null,nextRunAt:null,failedAt:null,stage:'retrying'});console.log('DrukTube media worker running');while(!global.__stop){let did=false;for(let i=0;i<MAX;i++)did=(await runOne())||did;if(!did)await new Promise(r=>setTimeout(r,POLL));}}
process.on('SIGTERM',()=>global.__stop=true);process.on('SIGINT',()=>global.__stop=true);main();
