const fs=require('fs');
const {Pool}=require('pg');

function createRuntime({dataFile,schemaFile}){
  const enabled=process.env.DB_DRIVER==='postgres' && !!process.env.DATABASE_URL;
  const pool=enabled?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false}):null;
  let state=null;
  let writeQueue=Promise.resolve();
  const arr=x=>Array.isArray(x)?x:[];
  async function ensureSchema(){if(!enabled)return; await pool.query(fs.readFileSync(schemaFile,'utf8'));}
  async function load(json){
    state=json;
    if(!enabled)return state;
    await ensureSchema();
    const [u,v,s,c]=await Promise.all([
      pool.query('SELECT id,username,name,email,password_hash,role,verified,bio,avatar_url,banner_url,created_at FROM users'),
      pool.query('SELECT id,user_id,title,description,category,video_url,thumbnail_url,visibility,is_short,views,likes,comments_enabled,reactions_enabled,created_at FROM videos'),
      pool.query('SELECT user_id,creator_id,created_at FROM subscriptions'),
      pool.query('SELECT id,video_id,user_id,username,body,created_at,pinned FROM comments')
    ]);
    if(u.rows.length) state.users=u.rows.map(x=>({...state.users?.find(y=>y.id===x.id),id:x.id,username:x.username,name:x.name,email:x.email,passwordHash:x.password_hash,role:x.role,verified:x.verified,bio:x.bio,avatarUrl:x.avatar_url,bannerUrl:x.banner_url,createdAt:x.created_at}));
    if(v.rows.length) state.videos=v.rows.map(x=>({...state.videos?.find(y=>y.id===x.id),id:x.id,userId:x.user_id,title:x.title,description:x.description,category:x.category,videoUrl:x.video_url,thumbnailUrl:x.thumbnail_url,visibility:x.visibility,isShort:x.is_short,views:Number(x.views),likes:Number(x.likes),commentsEnabled:x.comments_enabled,reactionsEnabled:x.reactions_enabled,createdAt:x.created_at}));
    state.subscriptions=s.rows.map(x=>({userId:x.user_id,creatorId:x.creator_id,createdAt:x.created_at}));
    state.comments=c.rows.map(x=>({id:x.id,videoId:x.video_id,userId:x.user_id,username:x.username,body:x.body,createdAt:x.created_at,pinned:x.pinned}));
    return state;
  }
  function enqueue(fn){writeQueue=writeQueue.then(fn).catch(e=>console.error('PostgreSQL sync:',e.message));return writeQueue;}
  function sync(json){
    if(!enabled)return;
    enqueue(async()=>{
      await ensureSchema(); const client=await pool.connect();
      try{await client.query('BEGIN');
        for(const u of arr(json.users)) await client.query(`INSERT INTO users(id,username,name,email,password_hash,role,verified,bio,avatar_url,banner_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,verified=EXCLUDED.verified,bio=EXCLUDED.bio,avatar_url=EXCLUDED.avatar_url,banner_url=EXCLUDED.banner_url`,[u.id,u.username,u.name||u.username,u.email,u.passwordHash||null,u.role||'user',!!u.verified,u.bio||'',u.avatarUrl||'',u.bannerUrl||'',u.createdAt||new Date()]);
        for(const v of arr(json.videos)) await client.query(`INSERT INTO videos(id,user_id,title,description,category,video_url,thumbnail_url,visibility,is_short,views,likes,comments_enabled,reactions_enabled,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,category=EXCLUDED.category,video_url=EXCLUDED.video_url,thumbnail_url=EXCLUDED.thumbnail_url,visibility=EXCLUDED.visibility,is_short=EXCLUDED.is_short,views=EXCLUDED.views,likes=EXCLUDED.likes,comments_enabled=EXCLUDED.comments_enabled,reactions_enabled=EXCLUDED.reactions_enabled`,[v.id,v.userId,v.title||'Untitled',v.description||'',v.category||'Bhutan',v.videoUrl||'',v.thumbnailUrl||'',v.visibility||'public',!!(v.isShort||v.isShorts),Number(v.views||0),Number(v.likes||0),v.commentsEnabled!==false,v.reactionsEnabled!==false,v.createdAt||new Date()]);
        await client.query('DELETE FROM subscriptions'); for(const s of arr(json.subscriptions)){const uid=s.userId||s.subscriberId,cid=s.creatorId||s.channelId;if(uid&&cid) await client.query('INSERT INTO subscriptions(user_id,creator_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[uid,cid,s.createdAt||new Date()]);}
        await client.query('DELETE FROM comments'); for(const c of arr(json.comments)) await client.query('INSERT INTO comments(id,video_id,user_id,username,body,created_at,pinned) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET body=EXCLUDED.body,pinned=EXCLUDED.pinned',[c.id,c.videoId,c.userId,c.username||'',c.body||'',c.createdAt||new Date(),!!c.pinned]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    });
  }
  const featureKeys=['sessions','announcements','notifications','reports','playlists','watchLater','history','progress','chapters','verificationRequests','preferences','reactions','playlistShares','blocks'];
  function ownerId(x){return x&& (x.userId||x.ownerId||x.creatorId||x.subscriberId||null)}
  function normalizeFeature(k,json){
    if(k==='preferences') return Object.entries(json.preferences||{}).map(([userId,payload])=>({id:userId,userId,payload}));
    const arr=json[k]; return Array.isArray(arr)?arr.map(x=>({id:String(x.id||`${k}-${JSON.stringify(x).slice(0,24)}`),userId:ownerId(x),payload:x})):[];
  }
  async function syncFeatures(json){if(!enabled)return; enqueue(async()=>{await ensureSchema(); const client=await pool.connect(); try{await client.query('BEGIN');
    for(const feature of featureKeys){
      const rows=normalizeFeature(feature,json);
      await client.query('DELETE FROM feature_records WHERE feature=$1',[feature]);
      for(const row of rows) await client.query(`INSERT INTO feature_records(feature,id,owner_user_id,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NOW())`,[feature,row.id,row.userId,row.payload,row.payload?.createdAt||row.payload?.updatedAt||new Date()]);
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}})}
  async function loadFeatures(json){if(!enabled)return json; await ensureSchema(); const r=await pool.query('SELECT feature,id,owner_user_id,payload FROM feature_records');
    for(const k of featureKeys){if(k==='preferences')json.preferences={};else if(!Array.isArray(json[k]))json[k]=[];}
    for(const row of r.rows){ if(row.feature==='preferences') json.preferences[row.id]=row.payload; else json[row.feature].push(row.payload); } return json;
  }
  async function syncMedia(json){if(!enabled)return; enqueue(async()=>{await ensureSchema(); const client=await pool.connect(); try{await client.query('BEGIN'); await client.query('DELETE FROM media_objects'); for(const m of arr(json.mediaObjects)) await client.query(`INSERT INTO media_objects(id,video_id,object_key,bucket,content_type,size_bytes,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET object_key=EXCLUDED.object_key,bucket=EXCLUDED.bucket,content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,status=EXCLUDED.status`,[m.id,m.videoId,m.objectKey,m.bucket||'local',m.contentType||'application/octet-stream',Number(m.sizeBytes||0),m.status||'ready',m.createdAt||new Date()]); await client.query('COMMIT'); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}})}
  async function loadMedia(json){if(!enabled)return json; await ensureSchema(); const r=await pool.query('SELECT id,video_id,object_key,bucket,content_type,size_bytes,status,created_at FROM media_objects'); json.mediaObjects=r.rows.map(x=>({id:x.id,videoId:x.video_id,objectKey:x.object_key,bucket:x.bucket,contentType:x.content_type,sizeBytes:Number(x.size_bytes),status:x.status,createdAt:x.created_at})); return json;}
  async function mediaCounts(){if(!enabled)return {count:0,bytes:0}; const r=await pool.query('SELECT COUNT(*)::int count,COALESCE(SUM(size_bytes),0)::bigint bytes FROM media_objects'); return {count:r.rows[0].count,bytes:Number(r.rows[0].bytes)};}
  async function featureCounts(){if(!enabled)return []; const r=await pool.query("SELECT feature,COUNT(*)::int AS count FROM feature_records GROUP BY feature ORDER BY feature"); return r.rows;}
  async function close(){if(pool)await pool.end();}
  return {enabled,load,sync,syncFeatures,loadFeatures,featureCounts,syncMedia,loadMedia,mediaCounts,close,getState:()=>state};
}
module.exports={createRuntime};
