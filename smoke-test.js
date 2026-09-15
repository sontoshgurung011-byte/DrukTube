const http=require('http');
const port=Number(process.env.PORT||3000);
const req=http.get({host:'127.0.0.1',port,path:'/api/health'},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{const j=JSON.parse(b);if(!res.statusCode||res.statusCode>=400||!j.ok)throw new Error('Health check failed');console.log('DrukTube smoke test: PASS',j.version,j.database);process.exit(0)}catch(e){console.error('DrukTube smoke test: FAIL',e.message);process.exit(1)}})});
req.on('error',e=>{console.error('DrukTube smoke test: FAIL',e.message);process.exit(1)});
req.setTimeout(5000,()=>{req.destroy(new Error('timeout'))});
