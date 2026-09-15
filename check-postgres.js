const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
(async()=>{ const c=new Client({connectionString:url,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false}); try{await c.connect(); const r=await c.query('select current_database() db, now() as now'); console.log(JSON.stringify({ok:true,database:r.rows[0].db,time:r.rows[0].now},null,2));}catch(e){console.error('PostgreSQL check failed:',e.message);process.exitCode=1}finally{await c.end().catch(()=>{})}})();
