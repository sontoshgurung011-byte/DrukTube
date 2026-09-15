#!/usr/bin/env node
const fs=require('fs'),path=require('path'),cp=require('child_process'),os=require('os');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const requiredIds=['auth','authgo','authswap','acct','li','lp','ru','rn','re','rp','grid','watch','wv','upload','vf','vthumb','vthumbFile'];
const missing=requiredIds.filter(id=>!new RegExp(`\\bid=["']${id}["']`).test(html));
if(missing.length) throw new Error('Missing required DOM IDs: '+missing.join(', '));
if(!html.includes('function openAuth(mode="login")')) throw new Error('Auth opener missing');
if(!html.includes('classList.add("show")')) throw new Error('Auth modal show logic missing');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'druk-validate-'));
for(let i=0;i<scripts.length;i++){
  const f=path.join(tmp,`inline-${i}.js`);fs.writeFileSync(f,scripts[i]);
  cp.execFileSync(process.execPath,['--check',f],{stdio:'pipe'});
}
for(const f of ['server.js','worker.js','storage.js','queue.js','db/runtime.js','scripts/process-video.js']) cp.execFileSync(process.execPath,['--check',path.join(root,f)],{stdio:'pipe'});
if(/\.replace\(\/\^#\/\s*,\s*\)/.test(server)) throw new Error('Broken tag normalization expression remains');
if(!server.includes('version:"7.3.7",build:77')) throw new Error('Release version not updated');
console.log(`DrukTube release validation PASS — ${scripts.length} inline scripts checked.`);
