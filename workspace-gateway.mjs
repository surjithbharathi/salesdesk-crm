import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const directory=dirname(fileURLToPath(import.meta.url));
const dbPath=process.env.CRM_DB||join(directory,'data/crm.sqlite');
const mainOrigin=process.env.PUBLIC_ORIGIN;
if(!mainOrigin||new URL(mainOrigin).protocol!=='https:')throw Error('HTTPS PUBLIC_ORIGIN required for workspace gateway');
const mainHost=new URL(mainOrigin).hostname,baseDomain=mainHost.split('.').slice(1).join('.');
const freePort=()=>new Promise((resolve,reject)=>{const socket=net.createServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});});
const children=new Map();
function start(key,{db,origin,port,mobilePort,master=false}){
  const pending=(async()=>{
    const webPort=port||await freePort(),phonePort=mobilePort||await freePort();
    const inherited=master?process.env:Object.fromEntries(['PATH','NODE_ENV','HOME','TMPDIR','TZ','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    const child=spawn(process.execPath,['server.mjs'],{cwd:directory,env:{...inherited,PORT:String(webPort),MOBILE_PORT:String(phonePort),BIND_HOST:master?'0.0.0.0':'127.0.0.1',CRM_DB:db,PUBLIC_ORIGIN:origin,CRM_OWNER_USER_ID:master?process.env.CRM_OWNER_USER_ID||'':'',CRM_OWNER_CONTEXT:master?'1':'0',WORKSPACE_BASE_DOMAIN:baseDomain},stdio:['ignore','pipe','pipe']});
    child.on('exit',()=>children.delete(key));
    await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>{child.kill();reject(Error('Workspace startup timed out'));},20000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Salesdesk CRM:')&&output.includes('Device sync API:')){clearTimeout(timeout);resolve();}});child.stderr.on('data',()=>{});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Workspace stopped'));});});
    return {webPort,mobilePort:phonePort,child};
  })();children.set(key,pending);pending.catch(()=>children.delete(key));return pending;
}
const master=await start('main',{db:dbPath,origin:mainOrigin,port:3102,mobilePort:3101,master:true});
const registry=new DatabaseSync(dbPath,{readOnly:true});registry.exec('PRAGMA busy_timeout=5000');
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host||'';if(host.includes(':'))fail('Unrecognized workspace host',403);
    let runtime;
    if(host===mainHost)runtime=master;
    else{
      const row=registry.prepare('SELECT * FROM crm_workspaces WHERE host=?').get(host);if(!row)fail('Workspace not found',404);if(row.state!=='active')fail('Workspace is suspended',403);
      runtime=await (children.get(row.id)||start(row.id,{db:join(dirname(dbPath),'workspaces',row.id,'crm.sqlite'),origin:'https://'+row.host}));
    }
    const target=(req.url||'').startsWith('/v1/')?runtime.mobilePort:runtime.webPort;
    const headers={...req.headers};delete headers['x-forwarded-host'];delete headers['x-forwarded-for'];
    const proxy=http.request({hostname:'127.0.0.1',port:target,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    proxy.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Workspace runtime unavailable'}));}else res.destroy();});req.on('aborted',()=>proxy.destroy());req.pipe(proxy);
  }catch(error){res.writeHead(error.status||503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.status?error.message:'Workspace unavailable'}));}
});
server.listen(3100,'0.0.0.0',()=>console.log('Salesdesk workspace gateway ready'));
for(const row of registry.prepare("SELECT * FROM crm_workspaces WHERE state='active'").all())void start(row.id,{db:join(dirname(dbPath),'workspaces',row.id,'crm.sqlite'),origin:'https://'+row.host}).catch(()=>{});
setInterval(()=>{
  const rows=registry.prepare('SELECT * FROM crm_workspaces').all();
  for(const row of rows){if(row.state!=='active'&&children.has(row.id))children.get(row.id).then(runtime=>runtime.child.kill('SIGTERM')).catch(()=>{});else if(row.state==='active'&&!children.has(row.id))void start(row.id,{db:join(dirname(dbPath),'workspaces',row.id,'crm.sqlite'),origin:'https://'+row.host}).catch(()=>{});}
},5000).unref();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();for(const pending of children.values())pending.then(runtime=>runtime.child.kill('SIGTERM')).catch(()=>{});setTimeout(()=>process.exit(0),3000).unref();});
