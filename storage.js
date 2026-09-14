const fs=require('fs'),path=require('path'),crypto=require('crypto');
let S3Client,PutObjectCommand,DeleteObjectCommand;
try{({S3Client,PutObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3'));}catch(_){ }

function safeName(name){return String(name||'file').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(-180)}
function createStorage({root,uploadDir}){
  const driver=process.env.STORAGE_DRIVER||'local';
  const bucket=process.env.S3_BUCKET||'';
  const configured=driver==='s3'&&!!bucket&&!!process.env.S3_ACCESS_KEY&&!!process.env.S3_SECRET_KEY&&!!S3Client;
  const client=configured?new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true',credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}}):null;
  async function put(file,{videoId,kind='video'}={}){
    const ext=path.extname(file.originalname||file.filename||'').toLowerCase();
    const folder=videoId?`videos/${videoId}`:'images';
    const key=`${folder}/${kind}-${crypto.randomUUID()}${ext}`;
    if(configured){
      const body=fs.createReadStream(file.path);
      await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:file.mimetype||'application/octet-stream',ContentLength:file.size}));
      fs.unlinkSync(file.path);
      const base=process.env.S3_PUBLIC_BASE_URL||'';
      return {driver:'s3',objectKey:key,bucket,url:base?`${base.replace(/\/$/,'')}/${key}`:`${process.env.S3_ENDPOINT||''}/${bucket}/${key}`};
    }
    const final=path.join(uploadDir,key);
    fs.mkdirSync(path.dirname(final),{recursive:true});
    fs.renameSync(file.path,final);
    return {driver:'local',objectKey:key,bucket:'local',url:'/uploads/'+key};
  }
  async function remove(objectKey){
    if(!objectKey) return;
    if(configured){ await client.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey})); return; }
    const final=path.join(uploadDir,objectKey);
    if(fs.existsSync(final)) fs.unlinkSync(final);
  }
  return {driver,configured,put,remove,bucket};
}
module.exports={createStorage,safeName};
