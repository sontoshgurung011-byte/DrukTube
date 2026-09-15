const express=require("express"),multer=require("multer"),path=require("path"),fs=require("fs"),crypto=require("crypto"),child_process=require("child_process");
const {createRuntime}=require("./db/runtime");
const {createStorage}=require("./storage");
const jobQueue=require("./queue");
const app=express(),PORT=process.env.PORT||3000,ROOT=__dirname,DATA=path.join(ROOT,"data"),DB=path.join(DATA,"db.json"),UPLOAD=path.join(ROOT,"uploads");
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOAD,{recursive:true});
const initial={notifications:[],reports:[],subscriptions:[],users:[{id:"admin-001",username:"DrukTube",name:"DrukTube 🇧🇹",email:"admin@druk.tube",passwordHash:null,role:"admin",verified:true,bio:"Official DrukTube account.",followers:[],following:[],createdAt:new Date().toISOString()}],sessions:[],videos:[],comments:[],announcements:[],viewEvents:[],chatMessages:[]};
if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify(initial,null,2));
else { let d0=JSON.parse(fs.readFileSync(DB,"utf8")); let changed=false; if(!d0.viewEvents){d0.viewEvents=[];changed=true} if(!d0.chatMessages){d0.chatMessages=[];changed=true} if(!d0.playlists){d0.playlists=[];changed=true} if(!d0.watchLater){d0.watchLater=[];changed=true} if(!d0.history){d0.history=[];changed=true} if(!d0.progress){d0.progress=[];changed=true} if(!d0.chapters){d0.chapters=[];changed=true} if(!d0.verificationRequests){d0.verificationRequests=[];changed=true} if(!d0.preferences){d0.preferences={};changed=true} if(!d0.reactions){d0.reactions=[];changed=true} if(!d0.playlistShares){d0.playlistShares=[];changed=true} if(!d0.videos) d0.videos=[]; d0.videos.forEach(v=>{if(v.commentsEnabled===undefined){v.commentsEnabled=true;changed=true} if(v.reactionsEnabled===undefined){v.reactionsEnabled=true;changed=true}}); if(changed)fs.writeFileSync(DB,JSON.stringify(d0,null,2)); }
let memoryDb=JSON.parse(fs.readFileSync(DB,"utf8"));
const runtime=createRuntime({dataFile:DB,schemaFile:path.join(ROOT,"db","schema.sql")});
const db=()=>memoryDb;
const storage=createStorage({root:ROOT,uploadDir:UPLOAD});
const processingJobs=new Map();
const save=d=>{memoryDb=d;fs.writeFileSync(DB,JSON.stringify(d,null,2));runtime.sync(d);runtime.syncFeatures(d);runtime.syncMedia(d)};
const hash=p=>crypto.createHash("sha256").update(p).digest("hex"), token=()=>crypto.randomBytes(32).toString("hex");
app.disable("x-powered-by");
app.use((req,res,next)=>{const id=crypto.randomUUID();res.setHeader("X-Request-ID",id);res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");next()});
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("X-Frame-Options","SAMEORIGIN");next()});
app.use(express.json({limit:"2mb"}));app.use(express.urlencoded({extended:true}));
app.use("/uploads",express.static(UPLOAD,{maxAge:'30d',immutable:true,setHeaders:(res)=>{res.setHeader('Cache-Control','public, max-age=2592000, immutable');}}));
function optionalAuth(req,res,next){const h=req.headers.authorization||"",t=h.startsWith("Bearer ")?h.slice(7):"",d=db(),s=d.sessions.find(x=>x.token===t),u=s&&d.users.find(x=>x.id===s.userId);if(u){req.user=u;req.sessionToken=t}next()}
function auth(req,res,next){const h=req.headers.authorization||"",t=h.startsWith("Bearer ")?h.slice(7):"",d=db(),s=d.sessions.find(x=>x.token===t),u=s&&d.users.find(x=>x.id===s.userId);if(!u)return res.status(401).json({error:"Please sign in"});req.user=u;req.sessionToken=t;next()}
function pub(u){return{id:u.id,username:u.username,name:u.name,role:u.role,verified:u.verified,bio:u.bio||"",avatarUrl:u.avatarUrl||"",bannerUrl:u.bannerUrl||"",followers:(u.followers||[]).length,following:(u.following||[]).length,createdAt:u.createdAt}}
const OWNER_EMAIL="sontoshgurung011@gmail.com"; const OWNER_NAME="Sontosh | DrukTube"; const isStaff=u=>!!u&&(u.role==="admin"||u.role==="owner"); const isOwner=u=>!!u&&u.role==="owner";
const multerStorage=multer.diskStorage({destination:(_,__,cb)=>cb(null,UPLOAD),filename:(_,f,cb)=>cb(null,Date.now()+"-"+Math.random().toString(36).slice(2,9)+path.extname(f.originalname).toLowerCase())});
const upload=multer({storage:multerStorage,limits:{fileSize:500*1024*1024},fileFilter:(_,f,cb)=>f.mimetype.startsWith("video/")?cb(null,true):cb(new Error("Only video files are allowed"))});
const imageUpload=multer({storage:multerStorage,limits:{fileSize:10*1024*1024},fileFilter:(_,f,cb)=>f.mimetype.startsWith("image/")?cb(null,true):cb(new Error("Only image files are allowed"))});
app.get("/api/health",(_,r)=>r.json({ok:true,version:"7.3.7",build:77,status:"ready",environment:process.env.NODE_ENV||"development",database:runtime.enabled?"postgres":"json",time:new Date().toISOString()}));
const MEDIA_CDN_BASE_URL=String(process.env.MEDIA_CDN_BASE_URL||"").replace(/\/$/,"");
const MEDIA_SIGNING_SECRET=String(process.env.MEDIA_SIGNING_SECRET||process.env.S3_SECRET_KEY||"druk-tube-development-secret");
const MEDIA_SIGNED_URL_TTL=Math.max(30,Math.min(86400,Number(process.env.MEDIA_SIGNED_URL_TTL||900)));
if(process.env.NODE_ENV==="production" && !process.env.MEDIA_SIGNING_SECRET && !process.env.S3_SECRET_KEY) console.warn("WARNING: set MEDIA_SIGNING_SECRET in production.");
function mediaSignature(videoId,exp){return crypto.createHmac("sha256",MEDIA_SIGNING_SECRET).update(`${videoId}:${exp}`).digest("hex");}
function validMediaSignature(videoId,exp,sig){const expected=mediaSignature(videoId,exp),actual=String(sig||"");return Number.isFinite(exp)&&exp>=Math.floor(Date.now()/1000)&&actual.length===expected.length&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
app.get("/api/storage",(_,r)=>r.json({driver:storage.configured?"s3":"local",requestedDriver:storage.driver,databaseDriver:runtime.enabled?"postgres":"json",databaseConfigured:!!process.env.DATABASE_URL,objectStorageConfigured:storage.configured,bucket:storage.configured?storage.bucket:null,cdnConfigured:!!MEDIA_CDN_BASE_URL,signedUrls:true}));
app.get("/api/media",auth,async(q,r)=>{try{let items=(db().mediaObjects||[]).filter(m=>{let v=db().videos.find(x=>x.id===m.videoId);return v&&v.userId===q.user.id}); let pg=runtime.enabled?await runtime.mediaCounts():null; r.json({driver:storage.configured?"s3":"local",ownedObjects:items.length,postgres:pg})}catch(e){r.status(503).json({error:"Media store unavailable"})}});
app.get("/api/data-layer",(_,r)=>r.json({driver:runtime.enabled?"postgres":"json",postgresConfigured:!!process.env.DATABASE_URL,cutover:runtime.enabled?"active":"fallback",writeMode:runtime.enabled?"postgres+json-mirror":"json",featureData:runtime.enabled?"postgres":"json"}));
app.get("/api/data-layer/features",async(_,r)=>{if(!runtime.enabled)return r.json({driver:"json",features:[]});try{const counts=await runtime.featureCounts();r.json({driver:"postgres",features:counts})}catch(e){r.status(503).json({error:"PostgreSQL feature store unavailable"})}});
app.get("/api/release",(_,r)=>r.json({name:"DrukTube",version:"7.3.7",build:77,status:"production-ready",features:["media-cdn-delivery","signed-media-urls","etag-caching","postgres-runtime-cutover","feature-data-postgres","media-upload-pipeline","s3-compatible-object-storage","dual-write-safety","persistent-data-foundation","object-storage-ready","image-upload-pipeline","optimized-media-delivery","video-probing","range-streaming","ffmpeg-hls-processing","adaptive-qualities","adaptive-player","quality-selector","creator-upload-processing","processing-progress","hls-fallback","premium-ui","dark-mode","pwa","creator-tools","moderation","personalization","production-readiness","creator-monetization","tips","live-gifts","bob-payments","memberships","payouts","monetization-rules","earnings-ledger"]}));
app.post("/api/auth/register",(q,r)=>{
  try{
    const body=q.body&&typeof q.body==="object"?q.body:{};
    const username=String(body.username||"").trim(),name=String(body.name||"").trim(),email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
    if(!username||!email||!password)return r.status(400).json({error:"Username, email and password are required"});
    if(password.length<8)return r.status(400).json({error:"Password must be at least 8 characters"});
    const d=db();
    d.users=Array.isArray(d.users)?d.users:[];
    const usernameKey=username.toLowerCase();
    if(d.users.some(u=>String(u?.username||"").trim().toLowerCase()===usernameKey||String(u?.email||"").trim().toLowerCase()===email))return r.status(409).json({error:"Username or email already exists"});
    const isOwner=email===OWNER_EMAIL;
    const u={id:"user-"+Date.now()+"-"+crypto.randomBytes(4).toString("hex"),username,name:name||username,email,passwordHash:hash(password),role:isOwner?"owner":"user",verified:isOwner,bio:isOwner?OWNER_NAME:"",followers:[],following:[],createdAt:new Date().toISOString()};
    d.users.push(u);
    const t=token();
    d.sessions=Array.isArray(d.sessions)?d.sessions:[];
    d.sessions.push({token:t,userId:u.id,createdAt:new Date().toISOString()});
    save(d);
    return r.status(201).json({user:pub(u),token:t});
  }catch(e){
    console.error("Registration error:",e);
    return r.status(500).json({error:"Account creation failed. Please try again.",details:process.env.NODE_ENV==="production"?undefined:String(e&&e.message||e)});
  }
});
app.post("/api/auth/login",(q,r)=>{let{login,password}=q.body||{},d=db(),u=d.users.find(x=>x.username.toLowerCase()==(login||"").toLowerCase()||x.email.toLowerCase()==(login||"").toLowerCase());if(!u||u.disabled||!u.passwordHash||u.passwordHash!==hash(password||""))return r.status(401).json({error:u&&u.disabled?"This account is suspended":"Invalid username/email or password"});let t=token();d.sessions.push({token:t,userId:u.id,createdAt:new Date().toISOString()});save(d);r.json({user:pub(u),token:t})});
app.post("/api/auth/logout",auth,(q,r)=>{let d=db();d.sessions=d.sessions.filter(s=>s.token!==q.sessionToken);save(d);r.json({ok:true})});
app.get("/api/me",auth,(q,r)=>{let d=db(),pending=(d.verificationRequests||[]).find(x=>x.userId===q.user.id&&x.status==="pending");r.json({user:pub(q.user),verificationPending:!!pending});});
app.get("/api/preferences",auth,(q,r)=>{let d=db();r.json(d.preferences?.[q.user.id]||{notifications:true,emailNotifications:false,autoplay:true,personalized:true,showHistory:true})});
app.patch("/api/preferences",auth,(q,r)=>{let d=db();d.preferences=d.preferences||{};let cur=d.preferences[q.user.id]||{notifications:true,emailNotifications:false,autoplay:true,personalized:true,showHistory:true};["notifications","emailNotifications","autoplay","personalized","showHistory"].forEach(k=>{if(q.body[k]!==undefined)cur[k]=!!q.body[k]});d.preferences[q.user.id]=cur;save(d);r.json(cur)});
app.get("/api/account/export",auth,(q,r)=>{let d=db(),uid=q.user.id;r.json({exportedAt:new Date().toISOString(),user:pub(q.user),preferences:d.preferences?.[uid]||{},videos:d.videos.filter(v=>v.userId===uid),comments:d.comments.filter(c=>c.userId===uid),playlists:(d.playlists||[]).filter(x=>x.userId===uid),subscriptions:(d.subscriptions||[]).filter(x=>x.userId===uid),watchLater:(d.watchLater||[]).filter(x=>x.userId===uid),history:(d.history||[]).filter(x=>x.userId===uid)});});
app.post("/api/account/change-password",auth,(q,r)=>{let current=String(q.body?.currentPassword||""),next=String(q.body?.newPassword||"");if(!current||!next)return r.status(400).json({error:"Current and new password are required"});if(next.length<8)return r.status(400).json({error:"New password must be at least 8 characters"});if(hash(current)!==q.user.passwordHash)return r.status(401).json({error:"Current password is incorrect"});if(hash(next)===q.user.passwordHash)return r.status(400).json({error:"New password must be different"});let d=db(),u=d.users.find(x=>x.id===q.user.id);u.passwordHash=hash(next);d.sessions=(d.sessions||[]).filter(s=>s.token===q.sessionToken||s.userId!==u.id);save(d);r.json({ok:true,message:"Password changed. Other sessions were signed out."})});
app.post("/api/account/logout-all",auth,(q,r)=>{let d=db();d.sessions=(d.sessions||[]).filter(s=>s.token===q.sessionToken||s.userId!==q.user.id);save(d);r.json({ok:true})});
app.patch("/api/me",auth,(q,r)=>{
  let d=db(),u=d.users.find(x=>x.id===q.user.id);
  if(q.body.name!==undefined)u.name=String(q.body.name).trim().slice(0,80)||u.username;
  if(q.body.bio!==undefined)u.bio=String(q.body.bio).trim().slice(0,300);
  if(q.body.avatarUrl!==undefined)u.avatarUrl=String(q.body.avatarUrl).trim().slice(0,500);
  if(q.body.bannerUrl!==undefined)u.bannerUrl=String(q.body.bannerUrl).trim().slice(0,500);
  save(d);r.json({user:pub(u)});
});
app.post("/api/verification/request",auth,(q,r)=>{
  if(q.user.verified)return r.status(400).json({error:"Your account is already verified"});
  let d=db(), existing=(d.verificationRequests||[]).find(x=>x.userId===q.user.id&&x.status==="pending");
  if(existing)return r.json({pending:true,request:existing});
  d.verificationRequests=d.verificationRequests||[];
  let req={id:"verify-"+Date.now(),userId:q.user.id,reason:String(q.body.reason||"").trim().slice(0,500),status:"pending",createdAt:new Date().toISOString()};
  d.verificationRequests.unshift(req); save(d); r.status(201).json({pending:true,request:req});
});
app.get("/api/verification/status",auth,(q,r)=>{let d=db(),x=(d.verificationRequests||[]).filter(x=>x.userId===q.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];r.json({verified:!!q.user.verified,request:x||null});});
app.get("/api/admin/verification",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});let d=db();r.json((d.verificationRequests||[]).map(x=>({...x,user:d.users.find(u=>u.id===x.userId)?pub(d.users.find(u=>u.id===x.userId)):null})));});
app.post("/api/admin/verification/:id/resolve",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});let d=db(),x=(d.verificationRequests||[]).find(x=>x.id===q.params.id);if(!x)return r.status(404).json({error:"Verification request not found"});if(!["approved","rejected"].includes(q.body.status))return r.status(400).json({error:"Invalid status"});x.status=q.body.status;x.resolvedAt=new Date().toISOString();let u=d.users.find(u=>u.id===x.userId);if(u&&x.status==="approved"){u.verified=true;d.notifications=d.notifications||[];d.notifications.unshift({id:"note-"+Date.now(),userId:u.id,type:"verification",message:"Your DrukTube account has been verified. ✓",read:false,createdAt:new Date().toISOString()});}save(d);r.json({request:x,user:u?pub(u):null});});
app.get("/api/creators",(q,r)=>{let d=db(),term=(q.query.search||"").toLowerCase();let a=d.users.filter(u=>!isStaff(u)||u.username==="DrukTube").filter(u=>!term||(u.username+" "+u.name).toLowerCase().includes(term)).map(pub);r.json(a.slice(0,30))});
app.get("/api/users/:username",(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});r.json({user:pub(u)})});
app.post("/api/users/:username/follow",auth,(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});if(u.id===q.user.id)return r.status(400).json({error:"You cannot follow yourself"});u.followers=u.followers||[];q.user.following=q.user.following||[];let yes=u.followers.includes(q.user.id);u.followers=yes?u.followers.filter(id=>id!==q.user.id):[...u.followers,q.user.id];q.user.following=yes?q.user.following.filter(id=>id!==u.id):[...q.user.following,u.id];
if(!yes){d.notifications=d.notifications||[];d.notifications.unshift({id:"note-"+Date.now(),userId:u.id,type:"follow",message:"@"+q.user.username+" followed you.",read:false,createdAt:new Date().toISOString()});}
save(d);r.json({following:!yes,followers:u.followers.length})});
app.get("/api/users/:username/channel",optionalAuth,(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});let blocked=(q.user?.blocks||[]).includes(u.id);let videos=blocked?[]:d.videos.filter(v=>v.userId===u.id&&(v.visibility||"public")==="public").sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));let subscribed=!!q.user&&(d.subscriptions||[]).some(x=>x.userId===q.user.id&&x.creatorId===u.id);let following=!!q.user&&(u.followers||[]).includes(q.user.id);r.json({user:pub(u),videos,subscribed,following,blocked})});
app.get("/api/users/:username/videos",(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});r.json(d.videos.filter(v=>v.userId===u.id&&(v.visibility||"public")==="public").sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)))});

app.get("/api/history",auth,(q,r)=>{let d=db(),items=(d.history||[]).filter(x=>x.userId===q.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,50),ids=items.map(x=>x.videoId);r.json(ids.map(id=>d.videos.find(v=>v.id===id)).filter(Boolean))});
app.post("/api/history/:videoId",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.videoId);if(!v)return r.status(404).json({error:"Video not found"});d.history=(d.history||[]).filter(x=>!(x.userId===q.user.id&&x.videoId===v.id));d.history.unshift({id:"hist-"+Date.now(),userId:q.user.id,videoId:v.id,createdAt:new Date().toISOString()});let mine=d.history.filter(x=>x.userId===q.user.id).slice(0,50),others=d.history.filter(x=>x.userId!==q.user.id);d.history=mine.concat(others);save(d);r.json({ok:true})});
app.delete("/api/history",auth,(q,r)=>{let d=db();d.history=(d.history||[]).filter(x=>x.userId!==q.user.id);save(d);r.json({ok:true})});
app.get("/api/progress",auth,(q,r)=>{let d=db();let out=(d.progress||[]).filter(x=>x.userId===q.user.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,50);r.json(out.map(x=>({...x,video:d.videos.find(v=>v.id===x.videoId)})).filter(x=>x.video));});
app.post("/api/progress/:videoId",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.videoId);if(!v)return r.status(404).json({error:"Video not found"});let seconds=Math.max(0,Number(q.body?.seconds||0)),duration=Math.max(0,Number(q.body?.duration||0));d.progress=(d.progress||[]).filter(x=>!(x.userId===q.user.id&&x.videoId===v.id));d.progress.unshift({id:"prog-"+Date.now(),userId:q.user.id,videoId:v.id,seconds,duration,updatedAt:new Date().toISOString()});d.progress=d.progress.slice(0,500);v.watchSeconds=Math.max(0,Number(v.watchSeconds||0),Number(v.watchSeconds||0)+Math.min(seconds,duration));save(d);r.json({ok:true});});
app.delete("/api/progress",auth,(q,r)=>{let d=db();d.progress=(d.progress||[]).filter(x=>x.userId!==q.user.id);save(d);r.json({ok:true})});
app.get("/api/watch-later",auth,(q,r)=>{
  let d=db(), ids=new Set((d.watchLater||[]).filter(x=>x.userId===q.user.id).map(x=>x.videoId));
  r.json(d.videos.filter(v=>ids.has(v.id)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});
app.post("/api/videos/:id/watch-later",auth,(q,r)=>{
  let d=db(),v=d.videos.find(x=>x.id===q.params.id);
  if(!v)return r.status(404).json({error:"Video not found"});
  d.watchLater=d.watchLater||[]; let i=d.watchLater.findIndex(x=>x.userId===q.user.id&&x.videoId===v.id);
  if(i>=0){d.watchLater.splice(i,1);save(d);return r.json({saved:false})}
  d.watchLater.unshift({id:"wl-"+Date.now(),userId:q.user.id,videoId:v.id,createdAt:new Date().toISOString()}); save(d); r.json({saved:true});
});

app.get("/api/analytics",auth,(q,r)=>{
  let d=db(), mine=d.videos.filter(v=>v.userId===q.user.id);
  let views=mine.reduce((n,v)=>n+(v.views||0),0), likes=mine.reduce((n,v)=>n+(v.likes||0),0);
  let comments=d.comments.filter(c=>mine.some(v=>v.id===c.videoId)).length;
  let followers=(d.follows||[]).filter(f=>f.creatorId===q.user.id).length;
  r.json({videos:mine.length,views,likes,comments,followers,shorts:mine.filter(v=>v.isShort).length});
});


app.get("/api/home-feed",auth,(q,r)=>{
  let d=db(), hist=(d.history||[]).filter(x=>x.userId===q.user.id), prog=(d.progress||[]).filter(x=>x.userId===q.user.id);
  let ids=new Set(hist.map(x=>x.videoId).concat(prog.map(x=>x.videoId)));
  let cats={};
  d.videos.filter(v=>ids.has(v.id)).forEach(v=>{cats[v.category||"Bhutan"]=(cats[v.category||"Bhutan"]||0)+1});
  let preferred=Object.keys(cats).sort((a,b)=>cats[b]-cats[a]);
  let mine=new Set((d.subscriptions||[]).filter(x=>x.userId===q.user.id).map(x=>x.creatorId));let blocked=new Set(q.user.blocks||[]);
  let arr=d.videos.filter(v=>!ids.has(v.id)&&!blocked.has(v.userId)).map(v=>{let score=(v.views||0)*0.25+(v.likes||0)*1; if(preferred.includes(v.category))score+=100-preferred.indexOf(v.category)*15; if(mine.has(v.userId))score+=80; return {v,score}}).sort((a,b)=>b.score-a.score).map(x=>x.v);
  if(!arr.length) arr=[...d.videos].sort((a,b)=>(b.views||0)-(a.views||0));
  r.json(arr.slice(0,30));
});

app.get("/api/trending",(q,r)=>{let d=db();r.json([...d.videos].sort((a,b)=>((b.views||0)*2+(b.likes||0)*3)-((a.views||0)*2+(a.likes||0)*3)).slice(0,20))});
app.get("/api/recommendations",(q,r)=>{let d=db(),cat=q.query.category||"";let a=d.videos.filter(v=>!cat||v.category===cat);r.json([...a].sort((x,y)=>((y.views||0)+(y.likes||0)*4)-((x.views||0)+(x.likes||0)*4)).slice(0,20))});
app.get("/api/categories",(q,r)=>{
  let d=db(), counts={};
  d.videos.forEach(v=>{let c=v.category||"Bhutan";counts[c]=(counts[c]||0)+1});
  let preferred=["All","Bhutan","News","Travel","Music","Gaming","Comedy","Shorts"];
  let cats=preferred.map(name=>({name,count:name==="All"?d.videos.length:(counts[name]||0)}));
  Object.keys(counts).filter(x=>!preferred.includes(x)).sort().forEach(name=>cats.push({name,count:counts[name]}));
  r.json(cats);
});

app.get("/api/community",auth,(q,r)=>{let d=db(),posts=(d.posts||[]).map(x=>({...x,author:d.users.find(u=>u.id===x.userId)})).filter(x=>x.author).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,50);r.json(posts.map(x=>({...x,author:pub(x.author),liked:(x.likedBy||[]).includes(q.user.id),likes:(x.likedBy||[]).length})))});
app.post("/api/community",auth,(q,r)=>{let body=String(q.body?.body||"").trim();if(!body)return r.status(400).json({error:"Post text is required"});if(body.length>500)return r.status(400).json({error:"Post is limited to 500 characters"});let d=db();d.posts=d.posts||[];let x={id:"post-"+Date.now(),userId:q.user.id,body,likedBy:[],createdAt:new Date().toISOString()};d.posts.unshift(x);save(d);r.status(201).json({...x,author:pub(q.user),liked:false,likes:0})});
app.post("/api/community/:id/like",auth,(q,r)=>{let d=db(),x=(d.posts||[]).find(p=>p.id===q.params.id);if(!x)return r.status(404).json({error:"Post not found"});x.likedBy=x.likedBy||[];let yes=x.likedBy.includes(q.user.id);x.likedBy=yes?x.likedBy.filter(id=>id!==q.user.id):[...x.likedBy,q.user.id];save(d);r.json({liked:!yes,likes:x.likedBy.length})});
app.delete("/api/community/:id",auth,(q,r)=>{let d=db(),i=(d.posts||[]).findIndex(p=>p.id===q.params.id);if(i<0)return r.status(404).json({error:"Post not found"});let x=d.posts[i];if(x.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only delete your own posts"});d.posts.splice(i,1);save(d);r.json({ok:true})});
app.get("/api/videos",(q,r)=>{let d=db(),arr=d.videos.filter(v=>(v.visibility||"public")==="public");let search=String(q.query.search||"").trim().toLowerCase();let cat=q.query.category;let tag=(q.query.tag||"").replace(/^#/ ,"").toLowerCase();let sort=q.query.sort||"relevance";if(search)arr=arr.filter(v=>(v.title+" "+v.description+" "+v.category+" "+v.username+" "+(v.tags||[]).join(" ")).toLowerCase().includes(search));if(tag)arr=arr.filter(v=>(v.tags||[]).some(t=>String(t).toLowerCase()===tag));if(cat&&cat!=="All")arr=arr.filter(v=>v.category===cat);if(search&&sort==="relevance"){let terms=search.split(/\s+/).filter(Boolean);const score=v=>{let title=String(v.title||"").toLowerCase(),desc=String(v.description||"").toLowerCase(),catx=String(v.category||"").toLowerCase(),user=String(v.username||"").toLowerCase(),tags=(v.tags||[]).join(" ").toLowerCase();let s=0;for(const t of terms){if(title===t)s+=120;if(title.includes(t))s+=60;if(tags.includes(t))s+=35;if(catx.includes(t))s+=25;if(user.includes(t))s+=20;if(desc.includes(t))s+=10;}s+=Math.min(15,(v.views||0)/1000);s+=Math.min(10,(v.likes||0)/100);return s};arr.sort((a,b)=>score(b)-score(a)||new Date(b.createdAt)-new Date(a.createdAt));}else arr.sort((a,b)=>sort==="views"?(b.views||0)-(a.views||0):sort==="likes"?(b.likes||0)-(a.likes||0):sort==="old"?new Date(a.createdAt)-new Date(b.createdAt):new Date(b.createdAt)-new Date(a.createdAt));r.json(arr)});
app.get("/api/search",(q,r)=>{let d=db(),term=String(q.query.q||"").trim().toLowerCase();if(!term)return r.json({videos:[],creators:[]});let terms=term.split(/\s+/).filter(Boolean);const score=v=>{let title=String(v.title||"").toLowerCase(),desc=String(v.description||"").toLowerCase(),cat=String(v.category||"").toLowerCase(),user=String(v.username||"").toLowerCase(),tags=(v.tags||[]).join(" ").toLowerCase();let s=0;for(const t of terms){if(title===t)s+=120;if(title.includes(t))s+=60;if(tags.includes(t))s+=35;if(cat.includes(t))s+=25;if(user.includes(t))s+=20;if(desc.includes(t))s+=10;}return s};let videos=d.videos.filter(v=>(v.visibility||"public")==="public"&&score(v)>0).sort((a,b)=>score(b)-score(a)||new Date(b.createdAt)-new Date(a.createdAt)).slice(0,12);let creators=d.users.filter(u=>(u.username+" "+u.name+" "+(u.bio||"")).toLowerCase().includes(term)).filter(u=>!isStaff(u)||u.username==="DrukTube").map(pub).slice(0,8);r.json({videos,creators})});
app.get("/api/tags",(q,r)=>{let d=db(),counts={};for(const v of d.videos){for(const t of (v.tags||[])){let k=String(t).trim().toLowerCase();if(k)counts[k]=(counts[k]||0)+1}}let tags=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,30).map(([tag,count])=>({tag,count}));r.json(tags)});
app.get("/api/tags/:tag",(q,r)=>{let d=db(),tag=decodeURIComponent(q.params.tag).replace(/^#/,'').toLowerCase();let videos=d.videos.filter(v=>(v.tags||[]).some(t=>String(t).toLowerCase()===tag)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));r.json({tag,videos:videos.slice(0,100)})});

app.get("/api/videos/:id",optionalAuth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if((v.visibility||"public")==="private"&&(!q.user||q.user.id!==v.userId&&!isStaff(q.user)))return r.status(403).json({error:"This video is private"});v.views=(v.views||0)+1;save(d);r.json(v)});
app.get("/api/videos/:id/chapters",(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});let chapters=(d.chapters||[]).filter(x=>x.videoId===v.id).sort((a,b)=>a.seconds-b.seconds);r.json(chapters)});
app.patch("/api/videos/:id/chapters",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only edit your own video chapters"});let input=Array.isArray(q.body.chapters)?q.body.chapters:[];let chapters=input.map((x,i)=>({id:"ch-"+Date.now()+"-"+i,videoId:v.id,seconds:Math.max(0,Number(x.seconds)||0),title:String(x.title||("Chapter "+(i+1))).trim().slice(0,80)})).filter(x=>x.title).sort((a,b)=>a.seconds-b.seconds).slice(0,30);d.chapters=(d.chapters||[]).filter(x=>x.videoId!==v.id).concat(chapters);save(d);r.json({chapters})});
app.get("/api/videos/:id/captions",(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});r.json((d.captions||[]).filter(x=>x.videoId===v.id).sort((a,b)=>a.start-b.start));});
app.patch("/api/videos/:id/captions",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only edit captions for your own video"});let input=Array.isArray(q.body.captions)?q.body.captions:[];let captions=input.map((x,i)=>({id:"cap-"+Date.now()+"-"+i,videoId:v.id,start:Math.max(0,Number(x.start)||0),end:Math.max(0,Number(x.end)||Math.max(1,(Number(x.start)||0)+4)),text:String(x.text||"").trim().slice(0,300)})).filter(x=>x.text&&x.end>x.start).sort((a,b)=>a.start-b.start).slice(0,200);d.captions=(d.captions||[]).filter(x=>x.videoId!==v.id).concat(captions);save(d);r.json({captions});});
app.get("/api/videos/:id/reactions",optionalAuth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});let rs=(d.reactions||[]).filter(x=>x.videoId===v.id);let counts={love:0,laugh:0,wow:0,sad:0,angry:0};for(const x of rs)if(counts[x.type]!==undefined)counts[x.type]++;let mine=q.user?((rs.find(x=>x.userId===q.user.id)||{}).type||null):null;r.json({counts,mine})});
app.post("/api/videos/:id/reactions",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});let type=String(q.body?.type||"").toLowerCase();if(!["love","laugh","wow","sad","angry"].includes(type))return r.status(400).json({error:"Invalid reaction"});if(v.reactionsEnabled===false)return r.status(403).json({error:"Reactions are disabled for this video"});d.reactions=d.reactions||[];let i=d.reactions.findIndex(x=>x.videoId===v.id&&x.userId===q.user.id);if(i>=0){if(d.reactions[i].type===type)d.reactions.splice(i,1);else d.reactions[i].type=type}else d.reactions.push({id:"reaction-"+Date.now(),videoId:v.id,userId:q.user.id,type,createdAt:new Date().toISOString()});save(d);let rs=d.reactions.filter(x=>x.videoId===v.id),counts={love:0,laugh:0,wow:0,sad:0,angry:0};for(const x of rs)if(counts[x.type]!==undefined)counts[x.type]++;let mine=(rs.find(x=>x.userId===q.user.id)||{}).type||null;r.json({counts,mine})});
app.get("/api/videos/:id/comments",(q,r)=>{let d=db();let arr=d.comments.filter(c=>c.videoId===q.params.id).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||new Date(a.createdAt)-new Date(b.createdAt));r.json(arr)});
app.get("/api/videos/:id/related",(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});let a=d.videos.filter(x=>x.id!==v.id&&(x.category===v.category||x.username===v.username)).sort((x,y)=>((y.views||0)+(y.likes||0)*3)-((x.views||0)+(x.likes||0)*3));r.json(a.slice(0,8))});

app.post("/api/videos/:id/like",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});v.likedBy=v.likedBy||[];let yes=v.likedBy.includes(q.user.id);v.likedBy=yes?v.likedBy.filter(id=>id!==q.user.id):[...v.likedBy,q.user.id];v.likes=v.likedBy.length;if(!yes&&v.userId!==q.user.id){d.notifications=d.notifications||[];d.notifications.unshift({id:"note-"+Date.now()+"-like",userId:v.userId,type:"like",videoId:v.id,message:"@"+q.user.username+" liked your video: "+v.title,read:false,createdAt:new Date().toISOString()})}save(d);r.json({liked:!yes,likes:v.likes})});
app.post("/api/videos/:id/comments",auth,(q,r)=>{if(!q.body.body)return r.status(400).json({error:"Comment is required"});let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if(v.commentsEnabled===false)return r.status(403).json({error:"Comments are disabled for this video"});let c={id:"comment-"+Date.now(),videoId:q.params.id,userId:q.user.id,username:q.user.username,body:String(q.body.body).slice(0,1000),createdAt:new Date().toISOString()};d.comments.push(c);if(v.userId!==q.user.id){d.notifications=d.notifications||[];d.notifications.unshift({id:"note-"+Date.now()+"-comment",userId:v.userId,type:"comment",videoId:v.id,message:"@"+q.user.username+" commented on your video: "+v.title,read:false,createdAt:new Date().toISOString()})}save(d);r.status(201).json({comment:c})});
app.delete("/api/comments/:id",auth,(q,r)=>{let d=db(),i=d.comments.findIndex(c=>c.id===q.params.id);if(i<0)return r.status(404).json({error:"Comment not found"});let c=d.comments[i];if(c.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only delete your own comments"});d.comments.splice(i,1);save(d);r.json({ok:true})});
app.post("/api/comments/:id/pin",auth,(q,r)=>{let d=db(),c=d.comments.find(x=>x.id===q.params.id);if(!c)return r.status(404).json({error:"Comment not found"});let v=d.videos.find(x=>x.id===c.videoId);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"Only the video creator can pin comments"});d.comments.filter(x=>x.videoId===v.id).forEach(x=>x.pinned=false);c.pinned=true;save(d);r.json({comment:c})});
app.delete("/api/comments/:id/pin",auth,(q,r)=>{let d=db(),c=d.comments.find(x=>x.id===q.params.id);if(!c)return r.status(404).json({error:"Comment not found"});let v=d.videos.find(x=>x.id===c.videoId);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"Only the video creator can unpin comments"});c.pinned=false;save(d);r.json({ok:true})});
app.post("/api/images",auth,imageUpload.single("image"),async(q,r)=>{
  if(!q.file)return r.status(400).json({error:"Choose an image"});
  const purpose=String(q.body?.purpose||"").toLowerCase();
  if(!["thumbnail","avatar","banner"].includes(purpose)){try{fs.unlinkSync(q.file.path)}catch(_){} return r.status(400).json({error:"Purpose must be thumbnail, avatar, or banner"});}
  const d=db(), videoId=String(q.body?.videoId||"");
  if(purpose==="thumbnail"){
    const v=d.videos.find(x=>x.id===videoId);
    if(!v)return r.status(404).json({error:"Video not found"});
    if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only edit your own thumbnail"});
  }
  try{
    const stored=await storage.put(q.file,{videoId:purpose==="thumbnail"?videoId:null,kind:purpose});
    const media={id:"media-"+Date.now()+"-"+crypto.randomUUID().slice(0,8),videoId:purpose==="thumbnail"?videoId:null,userId:q.user.id,purpose,objectKey:stored.objectKey,bucket:stored.bucket,contentType:q.file.mimetype,sizeBytes:q.file.size,status:"ready",url:stored.url,createdAt:new Date().toISOString()};
    d.mediaObjects=d.mediaObjects||[];d.mediaObjects.push(media);
    if(purpose==="thumbnail")d.videos.find(x=>x.id===videoId).thumbnailUrl=stored.url;
    if(purpose==="avatar")d.users.find(x=>x.id===q.user.id).avatarUrl=stored.url;
    if(purpose==="banner")d.users.find(x=>x.id===q.user.id).bannerUrl=stored.url;
    save(d);
    r.status(201).json({media,url:stored.url,purpose});
  }catch(e){try{if(fs.existsSync(q.file.path))fs.unlinkSync(q.file.path)}catch(_){} r.status(500).json({error:"Image storage failed"});}
});

function probeVideo(filePath){
  try{
    const raw=child_process.execFileSync("ffprobe",["-v","error","-show_entries","format=duration,size:stream=width,height,codec_name,codec_type","-of","json",filePath],{encoding:"utf8",timeout:15000});
    const j=JSON.parse(raw), streams=j.streams||[], video=streams.find(x=>x.codec_type==="video")||{}, audio=streams.find(x=>x.codec_type==="audio")||{};
    return {durationSeconds:Number(j.format?.duration||0),width:Number(video.width||0),height:Number(video.height||0),videoCodec:video.codec_name||"",audioCodec:audio.codec_name||"",probeStatus:"ready"};
  }catch(e){return {durationSeconds:0,width:0,height:0,videoCodec:"",audioCodec:"",probeStatus:"unavailable"};}
}

app.post("/api/videos",auth,upload.single("video"),async(q,r)=>{
  if(!q.file)return r.status(400).json({error:"Choose a video"});
  let d=db(),tags=String(q.body.tags||"").split(",").map(x=>x.trim().replace(/^#/ ,"").toLowerCase()).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).slice(0,12);
  const mediaInfo=probeVideo(q.file.path);
  let v={id:"video-"+Date.now(),title:q.body.title||q.file.originalname,description:q.body.description||"",category:q.body.category||"Bhutan",tags,username:q.user.username,userId:q.user.id,fileUrl:"",size:q.file.size,mimeType:q.file.mimetype,thumbnailUrl:q.body.thumbnailUrl||"",commentsEnabled:q.body.commentsEnabled!==false,reactionsEnabled:q.body.reactionsEnabled!==false,visibility:["public","unlisted","private"].includes(q.body.visibility)?q.body.visibility:"public",views:0,likes:0,likedBy:[],processingStatus:"ready",...mediaInfo,createdAt:new Date().toISOString()};
  d.videos.push(v); d.mediaObjects=d.mediaObjects||[];
  try{
    const stored=await storage.put(q.file,{videoId:v.id,kind:"video"});
    v.fileUrl=stored.url; v.storageDriver=stored.driver; v.objectKey=stored.objectKey;
    const m={id:"media-"+Date.now(),videoId:v.id,userId:q.user.id,objectKey:stored.objectKey,bucket:stored.bucket,contentType:q.file.mimetype,sizeBytes:q.file.size,status:"ready",durationSeconds:v.durationSeconds,width:v.width,height:v.height,videoCodec:v.videoCodec,audioCodec:v.audioCodec,createdAt:new Date().toISOString()};
    d.mediaObjects.push(m); if(stored.driver==="local"){v.processingStatus="queued";v.processingProgress=0;} save(d); let job=null; if(stored.driver==="local"){job=jobQueue.create("video-process",{videoId:v.id,userId:q.user.id},3); v.processingJobId=job.id; save(d);} r.status(201).json({video:v,media:m,job,streamUrl:"/api/videos/"+v.id+"/stream",processing:processingSnapshot(v)});
  }catch(e){d.videos=d.videos.filter(x=>x.id!==v.id);try{if(fs.existsSync(q.file.path))fs.unlinkSync(q.file.path)}catch(_){}return r.status(500).json({error:"Video storage failed"});}
});

function ffmpegAvailable(){try{child_process.execFileSync("ffmpeg",["-version"],{stdio:"ignore",timeout:5000});return true}catch(_){return false}}

function processingSnapshot(v){const local=processingJobs.get(v.id);const queued=jobQueue.list(200).filter(x=>x.payload?.videoId===v.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];const j=local||queued;return {videoId:v.id,jobId:j?.id||null,status:j?.status||v.processingStatus||"ready",progress:j?.progress??v.processingProgress??(v.processingStatus==="ready"?100:0),stage:j?.stage||v.processingStage||null,ffmpegAvailable:ffmpegAvailable(),hlsUrl:j?.hlsUrl||v.hlsUrl||null,renditions:Object.entries(j?.renditions||v.renditions||{}).map(([quality,x])=>({quality,url:x.url||null})),error:j?.error||v.processingError||null,startedAt:j?.startedAt||null,finishedAt:j?.completedAt||v.processedAt||null};}

app.get("/api/videos/:id/processing",optionalAuth,(q,r)=>{const d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});r.json(processingSnapshot(v));});

async function processVideoJob(v){
  const d=db();
  if(v.storageDriver!=="local"){v.processingStatus="waiting";save(d);processingJobs.set(v.id,{status:"waiting",progress:0,stage:"source-storage",error:"Automatic processing requires a locally accessible source video"});return;}
  if(!ffmpegAvailable()){v.processingStatus="failed";v.processingError="FFmpeg is not installed on this server";save(d);processingJobs.set(v.id,{status:"failed",progress:0,stage:"ffmpeg",error:v.processingError});return;}
  const source=path.join(UPLOAD,String(v.objectKey||"").replace(/^\/+/,""));
  if(!fs.existsSync(source)){v.processingStatus="failed";v.processingError="Source media not found";save(d);processingJobs.set(v.id,{status:"failed",progress:0,stage:"source",error:v.processingError});return;}
  const out=path.join(UPLOAD,"hls",v.id);fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});for(const n of ["v0","v1","v2"])fs.mkdirSync(path.join(out,n),{recursive:true});
  v.processingStatus="processing";v.processingProgress=0;save(d);
  const job={status:"processing",progress:0,stage:"encoding",startedAt:new Date().toISOString()};processingJobs.set(v.id,job);
  try{
    const total=Math.max(1,Number(v.durationSeconds||0));
    const args=["-y","-i",source,"-filter_complex","[0:v]split=3[v360][v720][v1080];[v360]scale=w=-2:h=360[v360o];[v720]scale=w=-2:h=720[v720o];[v1080]scale=w=-2:h=1080[v1080o]","-map","[v360o]","-map","0:a?","-map","[v720o]","-map","0:a?","-map","[v1080o]","-map","0:a?","-c:v:0","libx264","-c:v:1","libx264","-c:v:2","libx264","-preset","veryfast","-crf","23","-maxrate:v:0","900k","-bufsize:v:0","1800k","-maxrate:v:1","2500k","-bufsize:v:1","5000k","-maxrate:v:2","5000k","-bufsize:v:2","10000k","-c:a","aac","-b:a","128k","-ac","2","-f","hls","-hls_time","6","-hls_playlist_type","vod","-hls_flags","independent_segments","-master_pl_name","master.m3u8","-var_stream_map","v:0,a:0,name:360p v:1,a:1,name:720p v:2,a:2,name:1080p","-hls_segment_filename",path.join(out,"v%v","seg_%05d.ts"),path.join(out,"v%v","index.m3u8"),"-progress","pipe:2","-nostats"];
    await new Promise((resolve,reject)=>{const p=child_process.spawn("ffmpeg",args,{stdio:["ignore","ignore","pipe"]});let err="",buf="";p.stderr.on("data",x=>{buf+=x.toString();const lines=buf.split(/\r?\n/);buf=lines.pop()||"";for(const line of lines){if(line.startsWith("out_time_ms=")){const sec=Number(line.slice(12))/1000000;job.progress=Math.max(0,Math.min(99,Math.round(sec/total*100)));v.processingProgress=job.progress;save(db());}else if(line.startsWith("progress=end")){job.progress=100;}}err=(err+lineForError(lines)).slice(-2000)});function lineForError(a){return a.filter(x=>x&&!x.startsWith("out_time_")&&!x.startsWith("progress=")).join("\n")}p.on("error",reject);p.on("close",code=>code===0?resolve():reject(new Error(err||"FFmpeg failed")));});
    v.processingStatus="ready";v.processingProgress=100;v.hlsUrl="/api/videos/"+v.id+"/hls/master.m3u8";v.renditions={"360p":{url:"/api/videos/"+v.id+"/hls/v0/index.m3u8"},"720p":{url:"/api/videos/"+v.id+"/hls/v1/index.m3u8"},"1080p":{url:"/api/videos/"+v.id+"/hls/v2/index.m3u8"}};v.processedAt=new Date().toISOString();save(db());job.status="ready";job.progress=100;job.stage="complete";job.finishedAt=v.processedAt;return;
  }catch(e){v.processingStatus="failed";v.processingProgress=0;v.processingError=String(e.message||e).slice(0,1000);save(db());job.status="failed";job.stage="error";job.error=v.processingError;job.finishedAt=new Date().toISOString();}
}

app.post("/api/videos/:id/process",auth,async(q,r)=>{const d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only process your own videos"});const activeMemory=processingJobs.get(v.id);if(activeMemory?.status==="processing")return r.status(409).json(processingSnapshot(v));const existing=jobQueue.list(200).find(j=>j.payload?.videoId===v.id&&["queued","processing"].includes(j.status));if(existing)return r.status(409).json(processingSnapshot(v));v.processingStatus="queued";v.processingProgress=0;save(d);const job=jobQueue.create("video-process",{videoId:v.id,userId:v.userId},3);v.processingJobId=job.id;save(d);r.status(202).json({ok:true,queued:true,job,...processingSnapshot(v)});});

app.get("/api/videos/:id/media-url",auth,(q,r)=>{
  const d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});
  if(v.visibility==="private"&&v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"Private video"});
  const exp=Math.floor(Date.now()/1000)+MEDIA_SIGNED_URL_TTL;
  const pathUrl=`/api/videos/${encodeURIComponent(v.id)}/stream?exp=${exp}&sig=${mediaSignature(v.id,exp)}`;
  const cdn=MEDIA_CDN_BASE_URL&&v.storageDriver==="s3"&&v.objectKey?`${MEDIA_CDN_BASE_URL}/${String(v.objectKey).replace(/^\/+/,"")}`:null;
  r.json({url:cdn||pathUrl,expiresAt:new Date(exp*1000).toISOString(),ttlSeconds:MEDIA_SIGNED_URL_TTL,cdn:!!cdn});
});

app.get("/api/videos/:id/hls/*splat",optionalAuth,(q,r)=>{
  const d=db(),v=d.videos.find(x=>x.id===q.params.id); if(!v)return r.status(404).json({error:"Video not found"});
  if((v.visibility||"public")==="private"&&(!q.user||q.user.id!==v.userId))return r.status(403).json({error:"Private video"});
  let rel=Array.isArray(q.params.splat)?q.params.splat.join("/"):String(q.params.splat||""); rel=rel.replace(/^\/+/,""); if(!rel||rel.includes(".."))return r.status(400).json({error:"Invalid media path"});
  const file=path.join(UPLOAD,"hls",v.id,rel); if(!fs.existsSync(file)||!fs.statSync(file).isFile())return r.status(404).json({error:"HLS asset not found"});
  const type=file.endsWith(".m3u8")?"application/vnd.apple.mpegurl":"video/mp2t"; r.setHeader("Content-Type",type); r.setHeader("Cache-Control",file.endsWith(".m3u8")?"public, max-age=30":"public, max-age=31536000, immutable"); fs.createReadStream(file).pipe(r);
});

app.get("/api/videos/:id/stream",optionalAuth,(q,r)=>{
  const d=db(),v=d.videos.find(x=>x.id===q.params.id); if(!v)return r.status(404).json({error:"Video not found"});
  const isPrivate=(v.visibility||"public")==="private";const signed=validMediaSignature(v.id,Number(q.query.exp),String(q.query.sig||""));
  if(isPrivate&&(!q.user||q.user.id!==v.userId)&&!signed)return r.status(403).json({error:"Private video"});
  if(v.storageDriver==="s3"||String(v.fileUrl||"").startsWith("http"))return r.redirect(v.fileUrl);
  const key=String(v.objectKey||"").replace(/^\/+/,""); const file=path.join(UPLOAD,key); if(!fs.existsSync(file))return r.status(404).json({error:"Media file not found"});
  const stat=fs.statSync(file),size=stat.size,type=v.mimeType||"video/mp4",range=q.headers.range,etag=`W/\"${stat.size}-${Math.floor(stat.mtimeMs)}\"`; r.setHeader("Accept-Ranges","bytes");r.setHeader("Vary","Range");r.setHeader("ETag",etag);r.setHeader("Cache-Control",isPrivate?"private, max-age=0, no-store":"public, max-age=86400, stale-while-revalidate=3600");r.setHeader("Content-Type",type);if(q.headers["if-none-match"]===etag&&!range)return r.status(304).end();
  if(!range){r.setHeader("Content-Length",size);return fs.createReadStream(file).pipe(r);}
  const m=/bytes=(\d*)-(\d*)/.exec(range); if(!m)return r.status(416).end(); let start=m[1]?Number(m[1]):0,end=m[2]?Number(m[2]):size-1; if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=size||end<start){r.setHeader("Content-Range",`bytes */${size}`);return r.status(416).end();} end=Math.min(end,size-1); r.status(206).setHeader("Content-Range",`bytes ${start}-${end}/${size}`); r.setHeader("Content-Length",end-start+1); fs.createReadStream(file,{start,end}).pipe(r);
});

app.patch("/api/videos/:id",auth,(q,r)=>{let d=db(),v=d.videos.find(x=>x.id===q.params.id);if(!v)return r.status(404).json({error:"Video not found"});if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only edit your own videos"});["title","description","category","thumbnailUrl"].forEach(k=>{if(q.body[k]!==undefined)v[k]=String(q.body[k]).slice(0,2000)});if(q.body.visibility!==undefined&&["public","unlisted","private"].includes(String(q.body.visibility)))v.visibility=String(q.body.visibility);if(q.body.tags!==undefined)v.tags=String(q.body.tags).split(",").map(x=>x.trim().replace(/^#/ ,"").toLowerCase()).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).slice(0,12);if(q.body.commentsEnabled!==undefined)v.commentsEnabled=!!q.body.commentsEnabled;if(q.body.reactionsEnabled!==undefined)v.reactionsEnabled=!!q.body.reactionsEnabled;if(q.body.isShort!==undefined){v.isShort=!!q.body.isShort;if(v.isShort)v.category="Shorts"}save(d);r.json({video:v})});
app.delete("/api/videos/:id",auth,(q,r)=>{let d=db(),i=d.videos.findIndex(x=>x.id===q.params.id);if(i<0)return r.status(404).json({error:"Video not found"});let v=d.videos[i];if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only delete your own videos"});d.videos.splice(i,1);d.comments=d.comments.filter(c=>c.videoId!==v.id);save(d);r.json({ok:true})});

app.delete("/api/media/:id",auth,async(q,r)=>{let d=db(),m=(d.mediaObjects||[]).find(x=>x.id===q.params.id);if(!m)return r.status(404).json({error:"Media object not found"});let v=d.videos.find(x=>x.id===m.videoId);if(!v|| (v.userId!==q.user.id&&!isStaff(q.user)))return r.status(403).json({error:"You can only delete your own media"});try{await storage.remove(m.objectKey)}catch(e){return r.status(500).json({error:"Media deletion failed"});}d.mediaObjects=d.mediaObjects.filter(x=>x.id!==m.id);save(d);r.json({ok:true})});

app.get("/api/shorts",(q,r)=>{
  let d=db(), arr=d.videos.filter(v=>v.isShort||v.category==="Shorts"||v.short===true);
  arr=arr.sort((a,b)=>(b.views||0)-(a.views||0));
  r.json(arr);
});
app.post("/api/videos/:id/short",(q,r)=>{
  let d=db(),v=d.videos.find(x=>x.id===q.params.id);
  if(!v)return r.status(404).json({error:"Video not found"});
  if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only change your own videos"});
  v.isShort=!!q.body.isShort; if(v.isShort)v.category="Shorts";
  save(d);r.json({video:v});
});

// Build 32 — lightweight live/premiere chat API
app.get("/api/chat/:room",(q,r)=>{
  let d=db(), room=String(q.params.room).slice(0,100);
  let items=(d.chatMessages||[]).filter(x=>x.room===room).slice(-100);
  r.json(items);
});
app.post("/api/chat/:room",auth,(q,r)=>{
  let body=String(q.body.body||"").trim();
  if(!body)return r.status(400).json({error:"Message is required"});
  let d=db(), room=String(q.params.room).slice(0,100);
  d.chatMessages=d.chatMessages||[];
  let item={id:"chat-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),room,userId:q.user.id,username:q.user.username,body:body.slice(0,300),createdAt:new Date().toISOString()};
  d.chatMessages.push(item);
  d.chatMessages=d.chatMessages.slice(-2000);
  save(d); r.status(201).json({message:item});
});
app.delete("/api/chat/:id",auth,(q,r)=>{
  let d=db(), i=(d.chatMessages||[]).findIndex(x=>x.id===q.params.id);
  if(i<0)return r.status(404).json({error:"Message not found"});
  let x=d.chatMessages[i];
  if(x.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only delete your own message"});
  d.chatMessages.splice(i,1); save(d); r.json({ok:true});
});

// Build 31 — scheduled premieres / live event API
app.get("/api/premieres",(q,r)=>{
  let d=db(), now=Date.now();
  let arr=(d.premieres||[]).map(x=>{let v=d.videos.find(v=>v.id===x.videoId);return v?{...x,video:v}:null}).filter(Boolean)
    .sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
  r.json(arr);
});
app.post("/api/premieres",auth,(q,r)=>{
  let d=db(), v=d.videos.find(x=>x.id===q.body.videoId);
  if(!v)return r.status(404).json({error:"Video not found"});
  if(v.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only schedule your own video"});
  let when=new Date(q.body.scheduledAt);
  if(Number.isNaN(when.getTime())||when.getTime()<=Date.now())return r.status(400).json({error:"Choose a future premiere time"});
  d.premieres=d.premieres||[];
  d.premieres=d.premieres.filter(x=>x.videoId!==v.id);
  let item={id:"premiere-"+Date.now(),videoId:v.id,userId:q.user.id,scheduledAt:when.toISOString(),title:String(q.body.title||v.title).slice(0,200),createdAt:new Date().toISOString()};
  d.premieres.push(item); save(d); r.status(201).json({premiere:item});
});
app.delete("/api/premieres/:id",auth,(q,r)=>{
  let d=db(), i=(d.premieres||[]).findIndex(x=>x.id===q.params.id);
  if(i<0)return r.status(404).json({error:"Premiere not found"});
  let x=d.premieres[i];
  if(x.userId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:"You can only cancel your own premiere"});
  d.premieres.splice(i,1); save(d); r.json({ok:true});
});

app.get("/api/announcements",(_,r)=>r.json(db().announcements));
app.post("/api/announcements",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});if(!q.body.title||!q.body.body)return r.status(400).json({error:"Title and body are required"});let d=db(),a={id:"ann-"+Date.now(),title:q.body.title,body:q.body.body,author:"DrukTube",createdAt:new Date().toISOString()};d.announcements.unshift(a);save(d);r.status(201).json({announcement:a})});

// Monetization — configurable creator program, internal ledger, tips/memberships, and payout requests.
const MONETIZATION_DEFAULTS={enabled:true,minFollowers:100,minWatchHours:500,minShortsViews90d:100000,creatorSharePercent:60,platformSharePercent:40,minPayout:500,currency:'BTN',adRatePerThousand:2.50,tipFeePercent:0,membershipPlatformPercent:40,reviewRequired:true,liveGiftsEnabled:true,liveDonationsEnabled:true,bobPaymentEnabled:true,bobCurrency:'BTN',bobCheckoutUrl:'',bobMerchantId:'',bobWebhookSecretConfigured:false,liveGiftMin:10,liveGiftMax:5000,liveDonationMin:10,liveDonationMax:100000};
function monetizationConfig(d){d.monetization=d.monetization||{rules:{...MONETIZATION_DEFAULTS},applications:[],ledger:[],tips:[],memberships:[],payouts:[]};d.monetization.rules={...MONETIZATION_DEFAULTS,...(d.monetization.rules||{})};for(const k of ['applications','ledger','tips','memberships','payouts','liveGiftOrders'])d.monetization[k]=d.monetization[k]||[];return d.monetization}
function monetizationStats(d,uid){const mine=d.videos.filter(v=>v.userId===uid),ids=new Set(mine.map(v=>v.id)),cut=Date.now()-90*24*60*60*1000;const views=mine.reduce((n,v)=>n+Number(v.views||0),0);const shortsViews90d=(d.viewEvents||[]).filter(e=>ids.has(e.videoId)&&mine.find(v=>v.id===e.videoId)?.isShort&&new Date(e.createdAt).getTime()>=cut).length;const watchSeconds=mine.reduce((n,v)=>n+Number(v.watchSeconds||0),0);const followers=(d.users.find(u=>u.id===uid)?.followers||[]).length;return {followers,views,shortsViews90d,watchHours:Math.round((watchSeconds/3600)*100)/100,videos:mine.length}}
function monetizationEligibility(d,u){const m=monetizationConfig(d),st=monetizationStats(d,u.id),r=m.rules;const reasons=[];if(!r.enabled)reasons.push('Creator monetization is currently disabled.');if(st.followers<Number(r.minFollowers))reasons.push(`Need at least ${r.minFollowers} followers.`);if(st.watchHours<Number(r.minWatchHours)&&st.shortsViews90d<Number(r.minShortsViews90d))reasons.push(`Need ${r.minWatchHours} watch hours or ${r.minShortsViews90d} Shorts views.`);if(!u.verified)reasons.push('Creator verification is required.');if(u.disabled)reasons.push('Account is suspended.');const open=m.applications.find(a=>a.userId===u.id&&a.status==='pending');return {eligible:reasons.length===0,reasons,stats:st,application:open||m.applications.filter(a=>a.userId===u.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0]||null,monetized:!!u.monetized,rules:r}}
app.get('/api/monetization/rules',(_,r)=>{const d=db();r.json(monetizationConfig(d).rules)});
app.get('/api/monetization/status',auth,(q,r)=>{const d=db();r.json(monetizationEligibility(d,q.user))});
app.post('/api/monetization/apply',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),u=d.users.find(x=>x.id===q.user.id),e=monetizationEligibility(d,u);if(!e.eligible)return r.status(400).json({error:'You are not eligible yet.',reasons:e.reasons,stats:e.stats});if(u.monetized)return r.json({approved:true,monetized:true});if(m.applications.some(a=>a.userId===u.id&&a.status==='pending'))return r.json({pending:true});const a={id:'mon-'+Date.now(),userId:u.id,status:m.rules.reviewRequired?'pending':'approved',createdAt:new Date().toISOString(),country:String(q.body?.country||'').slice(0,80),payoutMethod:String(q.body?.payoutMethod||'manual').slice(0,40)};m.applications.unshift(a);if(a.status==='approved')u.monetized=true;save(d);r.status(201).json({application:a,monetized:u.monetized})});
app.get('/api/monetization/dashboard',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),u=d.users.find(x=>x.id===q.user.id),st=monetizationStats(d,u.id);const ledger=m.ledger.filter(x=>x.userId===u.id);const tips=m.tips.filter(x=>x.creatorId===u.id);const memberships=m.memberships.filter(x=>x.creatorId===u.id&&x.status==='active');const gross=ledger.reduce((n,x)=>n+Number(x.creatorAmount||0),0)+tips.reduce((n,x)=>n+Number(x.creatorAmount||0),0)+memberships.reduce((n,x)=>n+Number(x.creatorAmount||0),0);const paid=m.payouts.filter(x=>x.userId===u.id&&['requested','paid'].includes(x.status)).reduce((n,x)=>n+Number(x.amount||0),0);r.json({currency:m.rules.currency,eligible:monetizationEligibility(d,u),balance:Math.max(0,Math.round((gross-paid)*100)/100),gross:Math.round(gross*100)/100,paid:Math.round(paid*100)/100,earnings:ledger.slice(0,100),tips:tips.slice(0,100),memberships:memberships.slice(0,100),payouts:m.payouts.filter(x=>x.userId===u.id).slice(0,50)})});
app.get('/api/live/gifts/config',(_,r)=>{const d=db(),m=monetizationConfig(d);r.json({enabled:!!m.rules.liveGiftsEnabled,paymentProvider:'Bank of Bhutan',currency:m.rules.bobCurrency||'BTN',minAmount:Number(m.rules.liveGiftMin||10),maxAmount:Number(m.rules.liveGiftMax||5000),checkoutConfigured:!!m.rules.bobCheckoutUrl,merchantConfigured:!!m.rules.bobMerchantId,webhookConfigured:!!process.env.BOB_WEBHOOK_SECRET});});
app.get('/api/live/payments/:id',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),o=(m.liveGiftOrders||[]).find(x=>x.id===q.params.id);if(!o)return r.status(404).json({error:'Payment not found'});if(o.senderId!==q.user.id&&o.creatorId!==q.user.id&&!isStaff(q.user))return r.status(403).json({error:'Not authorized'});r.json(o)});
function createLivePayment(d,m,q,type){const creator=d.users.find(u=>u.id===q.body?.creatorId),amount=Number(q.body?.amount),liveId=String(q.body?.liveId||'').slice(0,120),name=String(q.body?.giftName||'Gift').slice(0,40);const min=type==='live-gift'?Number(m.rules.liveGiftMin):Number(m.rules.liveDonationMin),max=type==='live-gift'?Number(m.rules.liveGiftMax):Number(m.rules.liveDonationMax);if(!creator)return {status:404,error:'Creator not found'};if(q.user.id===creator.id)return {status:400,error:'You cannot send money to yourself'};if(!Number.isFinite(amount)||amount<min||amount>max)return {status:400,error:`Amount must be between BTN ${min} and BTN ${max}.`};const id=(type==='live-gift'?'gift-':'donation-')+Date.now()+'-'+crypto.randomUUID().slice(0,6);const order={id,senderId:q.user.id,creatorId:creator.id,liveId,giftName:type==='live-gift'?name:'Live donation',amount,currency:m.rules.bobCurrency||'BTN',provider:'Bank of Bhutan',type,status:m.rules.bobCheckoutUrl?'payment_pending':'awaiting_bob_gateway',creatorSharePercent:Number(m.rules.creatorSharePercent),platformSharePercent:Number(m.rules.platformSharePercent),creatorAmount:Math.round(amount*Number(m.rules.creatorSharePercent)/100*100)/100,platformAmount:Math.round(amount*Number(m.rules.platformSharePercent)/100*100)/100,createdAt:new Date().toISOString()};m.liveGiftOrders.unshift(order);const checkoutUrl=m.rules.bobCheckoutUrl?`${m.rules.bobCheckoutUrl}${m.rules.bobCheckoutUrl.includes('?')?'&':'?'}orderId=${encodeURIComponent(order.id)}&amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(order.currency)}`:null;save(d);return {status:201,body:{order,provider:'Bank of Bhutan',checkoutUrl,message:checkoutUrl?'Open Bank of Bhutan checkout to complete payment.':'BoB merchant/gateway credentials are not configured; payment remains pending and no money is charged.'}}}
app.post('/api/live/gifts/purchase',auth,(q,r)=>{const d=db(),m=monetizationConfig(d);if(!m.rules.liveGiftsEnabled)return r.status(503).json({error:'Live gifts are disabled'});const x=createLivePayment(d,m,q,'live-gift');r.status(x.status).json(x.body||{error:x.error});});
app.post('/api/live/donations/purchase',auth,(q,r)=>{const d=db(),m=monetizationConfig(d);if(!m.rules.liveDonationsEnabled)return r.status(503).json({error:'Live donations are disabled'});const x=createLivePayment(d,m,q,'live-donation');r.status(x.status).json(x.body||{error:x.error});});
app.post('/api/live/gifts/webhook',(q,r)=>{const secret=process.env.BOB_WEBHOOK_SECRET||'';if(!secret||q.headers['x-bob-webhook-secret']!==secret)return r.status(401).json({error:'BoB webhook is not configured or unauthorized'});const d=db(),m=monetizationConfig(d),o=(m.liveGiftOrders||[]).find(x=>x.id===q.body?.orderId);if(!o)return r.status(404).json({error:'Payment order not found'});const status=String(q.body?.status||'').toLowerCase();if(!['paid','failed','cancelled','refunded'].includes(status))return r.status(400).json({error:'Invalid payment status'});if(o.status==='paid'&&status==='paid')return r.json({ok:true,order:o});o.status=status;if(status==='paid'){o.paidAt=o.paidAt||new Date().toISOString();if(!m.ledger.some(e=>e.sourceId===o.id&&e.type===(o.type||'live-gift'))){const e={id:'earn-'+Date.now()+'-'+crypto.randomUUID().slice(0,6),userId:o.creatorId,type:o.type||'live-gift',sourceId:o.id,gross:o.amount,platformAmount:o.platformAmount,creatorAmount:o.creatorAmount,currency:o.currency,createdAt:o.paidAt};m.ledger.unshift(e);o.earningId=e.id}}save(d);r.json({ok:true,order:o});});
app.post('/api/monetization/tips',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),creator=d.users.find(u=>u.id===q.body?.creatorId),amount=Number(q.body?.amount);if(!creator)return r.status(404).json({error:'Creator not found'});if(!Number.isFinite(amount)||amount<Number(m.rules.liveDonationMin)||amount>Number(m.rules.liveDonationMax))return r.status(400).json({error:`Donation must be between BTN ${m.rules.liveDonationMin} and BTN ${m.rules.liveDonationMax}`});if(q.user.id===creator.id)return r.status(400).json({error:'You cannot donate to yourself'});const fee=Math.round(amount*Number(m.rules.tipFeePercent)/100*100)/100,creatorAmount=Math.round((amount-fee)*100)/100;const tip={id:'tip-'+Date.now()+'-'+crypto.randomUUID().slice(0,6),senderId:q.user.id,creatorId:creator.id,amount,fee,creatorAmount,currency:m.rules.bobCurrency||'BTN',provider:'Bank of Bhutan',status:m.rules.bobCheckoutUrl?'payment_pending':'awaiting_bob_gateway',createdAt:new Date().toISOString()};m.tips.unshift(tip);save(d);const checkoutUrl=m.rules.bobCheckoutUrl?`${m.rules.bobCheckoutUrl}${m.rules.bobCheckoutUrl.includes('?')?'&':'?'}orderId=${encodeURIComponent(tip.id)}&amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(tip.currency)}`:null;r.status(201).json({tip,checkoutUrl,message:checkoutUrl?'Open Bank of Bhutan checkout to complete the donation.':'BoB merchant/gateway credentials are not configured; donation remains pending and no money is charged.'})});
app.post('/api/monetization/memberships',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),creator=d.users.find(u=>u.id===q.body?.creatorId),amount=Number(q.body?.amount||4.99);if(!creator)return r.status(404).json({error:'Creator not found'});if(q.user.id===creator.id)return r.status(400).json({error:'You cannot join your own membership'});if(!Number.isFinite(amount)||amount<0.99||amount>99)return r.status(400).json({error:'Membership price must be between $0.99 and $99'});const creatorAmount=Math.round(amount*(1-Number(m.rules.membershipPlatformPercent)/100)*100)/100;let x=m.memberships.find(x=>x.userId===q.user.id&&x.creatorId===creator.id&&x.status==='active');if(x)return r.json({membership:x});x={id:'mem-'+Date.now(),userId:q.user.id,creatorId:creator.id,amount,creatorAmount,currency:m.rules.currency,status:'active',createdAt:new Date().toISOString()};m.memberships.unshift(x);save(d);r.status(201).json({membership:x,message:'Membership recorded. A payment provider must be connected before recurring charges are collected.'})});
app.post('/api/monetization/payouts',auth,(q,r)=>{const d=db(),m=monetizationConfig(d),u=q.user,amount=Number(q.body?.amount);const ledger=m.ledger.filter(x=>x.userId===u.id).reduce((n,x)=>n+Number(x.creatorAmount||0),0),tips=m.tips.filter(x=>x.creatorId===u.id).reduce((n,x)=>n+Number(x.creatorAmount||0),0),members=m.memberships.filter(x=>x.creatorId===u.id&&x.status==='active').reduce((n,x)=>n+Number(x.creatorAmount||0),0),paid=m.payouts.filter(x=>x.userId===u.id&&['requested','paid'].includes(x.status)).reduce((n,x)=>n+Number(x.amount||0),0),balance=Math.max(0,ledger+tips+members-paid);if(!u.monetized)return r.status(403).json({error:'Creator monetization is not active'});if(!Number.isFinite(amount)||amount<Number(m.rules.minPayout))return r.status(400).json({error:`Minimum payout is ${m.rules.currency} ${m.rules.minPayout}.`});if(amount>balance)return r.status(400).json({error:'Insufficient available balance'});const p={id:'payout-'+Date.now(),userId:u.id,amount,currency:m.rules.currency,status:'requested',method:String(q.body?.method||'manual').slice(0,40),createdAt:new Date().toISOString()};m.payouts.unshift(p);save(d);r.status(201).json({payout:p,message:'Payout request queued for admin/payment-provider processing.'})});
app.get('/api/admin/monetization',auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:'Admin access required'});const d=db(),m=monetizationConfig(d);r.json({rules:m.rules,applications:m.applications,payouts:m.payouts,ledger:m.ledger.slice(0,200),tips:m.tips.slice(0,200),memberships:m.memberships.slice(0,200)})});
app.patch('/api/admin/monetization/rules',auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:'Admin access required'});const d=db(),m=monetizationConfig(d);const allowed=['enabled','minFollowers','minWatchHours','minShortsViews90d','creatorSharePercent','platformSharePercent','minPayout','currency','adRatePerThousand','tipFeePercent','membershipPlatformPercent','reviewRequired','liveGiftsEnabled','liveDonationsEnabled','bobPaymentEnabled','bobCheckoutUrl','bobMerchantId','bobWebhookSecretConfigured','bobCurrency','liveGiftMin','liveGiftMax','liveDonationMin','liveDonationMax'];for(const k of allowed)if(q.body[k]!==undefined)m.rules[k]=typeof m.rules[k]==='boolean'?!!q.body[k]:typeof m.rules[k]==='number'?Number(q.body[k]):String(q.body[k]);if(Math.round((Number(m.rules.creatorSharePercent)+Number(m.rules.platformSharePercent))*100)/100!==100)return r.status(400).json({error:'Creator and platform shares must total 100%'});save(d);r.json(m.rules)});
app.post('/api/admin/monetization/applications/:id/resolve',auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:'Admin access required'});const d=db(),m=monetizationConfig(d),a=m.applications.find(x=>x.id===q.params.id);if(!a)return r.status(404).json({error:'Application not found'});if(!['approved','rejected'].includes(q.body?.status))return r.status(400).json({error:'Invalid status'});a.status=q.body.status;a.resolvedAt=new Date().toISOString();const u=d.users.find(x=>x.id===a.userId);if(u&&a.status==='approved')u.monetized=true;save(d);r.json({application:a,user:u?pub(u):null})});
app.post('/api/admin/monetization/earnings',auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:'Admin access required'});const d=db(),m=monetizationConfig(d),uid=String(q.body?.userId||''),amount=Number(q.body?.amount),type=String(q.body?.type||'ad-revenue');const u=d.users.find(x=>x.id===uid);if(!u)return r.status(404).json({error:'Creator not found'});if(!u.monetized)return r.status(400).json({error:'Creator is not monetized'});if(!Number.isFinite(amount)||amount<=0)return r.status(400).json({error:'Amount must be positive'});const platform=Math.round(amount*Number(m.rules.platformSharePercent)/100*100)/100,creatorAmount=Math.round((amount-platform)*100)/100;const e={id:'earn-'+Date.now(),userId:uid,type,sourceId:String(q.body?.sourceId||'').slice(0,120),gross:amount,platformAmount:platform,creatorAmount,currency:m.rules.currency,createdAt:new Date().toISOString()};m.ledger.unshift(e);save(d);r.status(201).json({earning:e})});

app.get("/api/stats",(_,r)=>{let d=db();r.json({users:d.users.length,videos:d.videos.length,comments:d.comments.length,reports:(d.reports||[]).filter(x=>x.status==="open").length,subscriptions:(d.subscriptions||[]).length})});
app.get("/api/admin/users",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});let d=db();r.json(d.users.map(u=>pub(u)));});
app.post("/api/admin/users/:id/suspend",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});let d=db(),u=d.users.find(x=>x.id===q.params.id);if(!u)return r.status(404).json({error:"User not found"});if(isStaff(u))return r.status(400).json({error:"Staff accounts cannot be suspended"});u.disabled=!u.disabled;if(u.disabled){d.sessions=(d.sessions||[]).filter(s=>s.userId!==u.id);}save(d);r.json({user:pub(u),disabled:!!u.disabled});});
app.get("/api/notifications",auth,(q,r)=>r.json((db().notifications||[]).filter(n=>n.userId===q.user.id).slice(0,50)));
app.post("/api/notifications/:id/read",auth,(q,r)=>{let d=db(),n=(d.notifications||[]).find(x=>x.id===q.params.id&&x.userId===q.user.id);if(!n)return r.status(404).json({error:"Notification not found"});n.read=true;save(d);r.json({ok:true})});
app.get("/api/notifications/unread-count",auth,(q,r)=>{let d=db();r.json({count:(d.notifications||[]).filter(n=>n.userId===q.user.id&&!n.read).length})});
app.post("/api/notifications/read",auth,(q,r)=>{let d=db();(d.notifications||[]).filter(n=>n.userId===q.user.id).forEach(n=>n.read=true);save(d);r.json({ok:true})});
app.get("/api/dashboard",auth,(q,r)=>{let d=db(),mine=d.videos.filter(v=>v.userId===q.user.id);r.json({videos:mine,totals:{videos:mine.length,views:mine.reduce((s,v)=>s+(v.views||0),0),likes:mine.reduce((s,v)=>s+(v.likes||0),0),followers:(q.user.followers||[]).length}})});
app.post("/api/reports",auth,(q,r)=>{let{videoId,reason}=q.body||{},d=db();if(!videoId||!reason)return r.status(400).json({error:"Video and reason are required"});if(!d.videos.some(v=>v.id===videoId))return r.status(404).json({error:"Video not found"});d.reports=d.reports||[];d.reports.unshift({id:"report-"+Date.now(),videoId,userId:q.user.id,reason:String(reason).slice(0,300),status:"open",createdAt:new Date().toISOString()});save(d);r.status(201).json({ok:true})});
app.get("/api/admin/reports",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});r.json(db().reports||[])});
app.post("/api/admin/reports/:id/resolve",auth,(q,r)=>{if(!isStaff(q.user))return r.status(403).json({error:"Admin access required"});let d=db(),x=(d.reports||[]).find(x=>x.id===q.params.id);if(!x)return r.status(404).json({error:"Report not found"});x.status=q.body.status==="removed"?"removed":"resolved";save(d);r.json({report:x})});
app.get("/api/blocks",auth,(q,r)=>{let d=db(),u=d.users.find(x=>x.id===q.user.id);r.json((u.blocks||[]).map(id=>d.users.find(x=>x.id===id)).filter(Boolean).map(pub))});
app.post("/api/blocks/:username",auth,(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});if(u.id===q.user.id)return r.status(400).json({error:"You cannot block yourself"});let me=d.users.find(x=>x.id===q.user.id);me.blocks=me.blocks||[];let i=me.blocks.indexOf(u.id);if(i>=0)me.blocks.splice(i,1);else me.blocks.push(u.id);save(d);r.json({blocked:i<0})});
app.get("/api/playlists",auth,(q,r)=>{let d=db();r.json((d.playlists||[]).filter(x=>x.userId===q.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)))});
app.get("/api/playlists/share/:token",(q,r)=>{let d=db(),sh=(d.playlistShares||[]).find(x=>x.token===q.params.token);if(!sh)return r.status(404).json({error:"Shared playlist not found"});let p=(d.playlists||[]).find(x=>x.id===sh.playlistId);if(!p)return r.status(404).json({error:"Playlist not found"});let ids=new Set(p.videoIds||[]);let owner=d.users.find(u=>u.id===p.userId);r.json({playlist:{...p,owner:owner?pub(owner):null},videos:d.videos.filter(v=>ids.has(v.id))})});
app.post("/api/playlists/:id/share",auth,(q,r)=>{let d=db(),p=(d.playlists||[]).find(x=>x.id===q.params.id&&x.userId===q.user.id);if(!p)return r.status(404).json({error:"Playlist not found"});d.playlistShares=d.playlistShares||[];let sh=d.playlistShares.find(x=>x.playlistId===p.id);if(!sh){sh={token:require("crypto").randomBytes(9).toString("hex"),playlistId:p.id,createdAt:new Date().toISOString()};d.playlistShares.push(sh);save(d)}r.json({token:sh.token})});
app.delete("/api/playlists/:id/share",auth,(q,r)=>{let d=db();let p=(d.playlists||[]).find(x=>x.id===q.params.id&&x.userId===q.user.id);if(!p)return r.status(404).json({error:"Playlist not found"});d.playlistShares=(d.playlistShares||[]).filter(x=>x.playlistId!==p.id);save(d);r.json({ok:true})});
app.get("/api/playlists/:id",auth,(q,r)=>{let d=db(),p=(d.playlists||[]).find(x=>x.id===q.params.id&&x.userId===q.user.id);if(!p)return r.status(404).json({error:"Playlist not found"});let ids=new Set(p.videoIds||[]);r.json({playlist:p,videos:d.videos.filter(v=>ids.has(v.id))})});
app.post("/api/playlists",auth,(q,r)=>{let name=String(q.body.name||"").trim();if(!name)return r.status(400).json({error:"Playlist name is required"});let d=db();d.playlists=d.playlists||[];let p={id:"pl-"+Date.now(),userId:q.user.id,name:name.slice(0,100),description:String(q.body.description||"").slice(0,300),videoIds:[],createdAt:new Date().toISOString()};d.playlists.unshift(p);save(d);r.status(201).json({playlist:p})});
app.delete("/api/playlists/:id",auth,(q,r)=>{let d=db(),i=(d.playlists||[]).findIndex(x=>x.id===q.params.id&&x.userId===q.user.id);if(i<0)return r.status(404).json({error:"Playlist not found"});d.playlists.splice(i,1);save(d);r.json({ok:true})});
app.post("/api/playlists/:id/videos/:videoId",auth,(q,r)=>{let d=db(),p=(d.playlists||[]).find(x=>x.id===q.params.id&&x.userId===q.user.id),v=d.videos.find(x=>x.id===q.params.videoId);if(!p)return r.status(404).json({error:"Playlist not found"});if(!v)return r.status(404).json({error:"Video not found"});p.videoIds=p.videoIds||[];let i=p.videoIds.indexOf(v.id);if(i>=0){p.videoIds.splice(i,1);save(d);return r.json({added:false})}p.videoIds.push(v.id);save(d);r.json({added:true})});
app.get("/api/subscriptions",auth,(q,r)=>{let d=db();r.json((d.subscriptions||[]).filter(x=>x.userId===q.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)))});
app.get("/api/feed",auth,(q,r)=>{let d=db(),ids=new Set((d.subscriptions||[]).filter(x=>x.userId===q.user.id).map(x=>x.creatorId));let blocked=new Set(q.user.blocks||[]);let arr=d.videos.filter(v=>ids.has(v.userId)&&!blocked.has(v.userId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));r.json(arr.slice(0,50))});
app.post("/api/subscriptions/:username",auth,(q,r)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===q.params.username.toLowerCase());if(!u)return r.status(404).json({error:"Creator not found"});if(u.id===q.user.id)return r.status(400).json({error:"You cannot subscribe to yourself"});d.subscriptions=d.subscriptions||[];let i=d.subscriptions.findIndex(x=>x.userId===q.user.id&&x.creatorId===u.id);if(i>=0)d.subscriptions.splice(i,1);else d.subscriptions.push({id:"sub-"+Date.now(),userId:q.user.id,creatorId:u.id,createdAt:new Date().toISOString()});save(d);r.json({subscribed:i<0})});
app.get('/api/jobs',auth,(req,res)=>{const jobs=jobQueue.list(Math.min(Number(req.query.limit)||50,200)).filter(j=>j.payload?.userId===req.user.id||isStaff(req.user));res.json({ok:true,jobs,active:jobs.filter(j=>j.status==='processing').length,queued:jobs.filter(j=>j.status==='queued').length,failed:jobs.filter(j=>j.status==='failed').length});});
app.post('/api/jobs/video-process',auth,(req,res)=>{const videoId=req.body&&req.body.videoId;if(!videoId)return res.status(400).json({error:'videoId is required'});const v=db().videos.find(x=>x.id===videoId);if(!v)return res.status(404).json({error:'Video not found'});if(v.userId!==req.user.id&&!isStaff(req.user))return res.status(403).json({error:'Not allowed'});const job=jobQueue.create('video-process',{videoId,userId:v.userId},3);res.status(202).json({ok:true,job});});
app.post('/api/jobs/:id/retry',auth,(req,res)=>{const j=jobQueue.list(500).find(x=>x.id===req.params.id);if(!j)return res.status(404).json({error:'Job not found'});if(j.payload?.userId!==req.user.id&&!isStaff(req.user))return res.status(403).json({error:'Not allowed'});const updated=jobQueue.update(j.id,{status:'queued',progress:0,error:null,nextRunAt:null,failedAt:null});res.json({ok:true,job:updated});});
app.post('/api/jobs/:id/cancel',auth,(req,res)=>{const j=jobQueue.list(500).find(x=>x.id===req.params.id);if(!j)return res.status(404).json({error:'Job not found'});if(j.payload?.userId!==req.user.id&&!isStaff(req.user))return res.status(403).json({error:'Not allowed'});const updated=jobQueue.update(j.id,{status:'cancelled',cancelledAt:new Date().toISOString()});res.json({ok:true,job:updated});});
app.use(express.static(path.join(ROOT,"public")));app.get(/.*/,(_,r)=>r.sendFile(path.join(ROOT,"public","index.html")));
app.use((e,_,r,__)=>r.status(400).json({error:e.message||"Request failed"}));
const server=app.use((err,req,res,next)=>{
  console.error("Unhandled API error:",err);
  if(res.headersSent)return next(err);
  res.status(500).json({error:"Server error. Please try again."});
});
app.listen(PORT,"0.0.0.0",async()=>{try{if(runtime.enabled){await runtime.load(memoryDb);await runtime.loadFeatures(memoryDb);await runtime.loadMedia(memoryDb);}}catch(e){console.error("PostgreSQL startup load:",e.message)} try{const owner=db().users.find(u=>String(u.email||"").trim().toLowerCase()===OWNER_EMAIL); if(owner && (owner.role!=="owner" || owner.name!==OWNER_NAME || !owner.verified || owner.disabled)){owner.role="owner";owner.name=OWNER_NAME;owner.verified=true;owner.disabled=false;owner.owner=true;owner.ownerSince=owner.ownerSince||new Date().toISOString();owner.bio=owner.bio||OWNER_NAME;save(db());console.log("DrukTube owner provisioned for "+OWNER_EMAIL)}}catch(e){console.error("Owner provisioning:",e.message)} console.log("DrukTube 7.3.7: http://localhost:"+PORT)});
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
process.on("SIGINT",()=>server.close(()=>process.exit(0)));

