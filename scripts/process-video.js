#!/usr/bin/env node
const fs=require('fs'),path=require('path'),cp=require('child_process');
const input=process.argv[2], out=process.argv[3]||path.join(path.dirname(input),'processed-'+Date.now());
if(!input||!fs.existsSync(input)){console.error('Usage: node scripts/process-video.js <input> [output-dir]');process.exit(2)}
fs.mkdirSync(out,{recursive:true});
const master=path.join(out,'master.m3u8');
const args=['-y','-i',input,'-filter_complex','[0:v]split=3[v360][v720][v1080];[v360]scale=w=-2:h=360[v360o];[v720]scale=w=-2:h=720[v720o];[v1080]scale=w=-2:h=1080[v1080o]','-map','[v360o]','-map','0:a?','-map','[v720o]','-map','0:a?','-map','[v1080o]','-map','0:a?','-c:v:0','libx264','-c:v:1','libx264','-c:v:2','libx264','-preset','veryfast','-crf','23','-maxrate:v:0','900k','-bufsize:v:0','1800k','-maxrate:v:1','2500k','-bufsize:v:1','5000k','-maxrate:v:2','5000k','-bufsize:v:2','10000k','-c:a','aac','-b:a','128k','-ac','2','-f','hls','-hls_time','6','-hls_playlist_type','vod','-hls_flags','independent_segments','-master_pl_name','master.m3u8','-var_stream_map','v:0,a:0,name:360p v:1,a:1,name:720p v:2,a:2,name:1080p','-hls_segment_filename',path.join(out,'v%v','seg_%05d.ts'),path.join(out,'v%v','index.m3u8')];
for(const n of ['v0','v1','v2'])fs.mkdirSync(path.join(out,n),{recursive:true});
const durationProbe=()=>{try{const raw=cp.execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',input],{encoding:'utf8',timeout:15000});return Number(raw.trim())||0}catch(_){return 0}};
const total=durationProbe();
const progressArgs=['-progress','pipe:1','-nostats'];
const ffArgs=[...args.slice(0,1),...args.slice(1, -2), ...progressArgs, ...args.slice(-2)];
// ffmpeg accepts progress output alongside the HLS output; parse out_time for real percent updates.
const child=cp.spawn('ffmpeg',ffArgs,{stdio:['ignore','pipe','pipe']});
let stderr=''; let buf='';
child.stdout.on('data',chunk=>{buf+=chunk.toString(); const lines=buf.split(/\r?\n/); buf=lines.pop()||''; for(const line of lines){if(line.startsWith('out_time_ms=')){const sec=Number(line.slice(12))/1000000; const pct=total?Math.max(0,Math.min(99,Math.round(sec/total*100))):0; process.stdout.write('JOB_PROGRESS '+JSON.stringify({progress:pct,stage:'encoding'})+'\n');} else if(line==='progress=end'){process.stdout.write('JOB_PROGRESS '+JSON.stringify({progress:100,stage:'finalizing'})+'\n');}}});
child.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(-4000)});
child.on('error',e=>{console.error(e.message);process.exit(1)});
child.on('close',code=>{if(code!==0){console.error(stderr||'FFmpeg processing failed. Ensure ffmpeg is installed.');process.exit(code||1)} process.stdout.write('JOB_PROGRESS '+JSON.stringify({progress:100,stage:'complete'})+'\n'); console.log(JSON.stringify({master,output:out,variants:['360p','720p','1080p']}));});
