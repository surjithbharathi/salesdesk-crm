import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,chmodSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createUserAuth} from './user-auth.mjs';
import {createWorkspaceAccess} from './workspace-access.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const WORKSPACE_SLOTS=5;
export function createWorkspaceRegistry({db,dbPath,ownerId,get,baseDomain,mainOrigin}){
  db.exec('CREATE TABLE IF NOT EXISTS crm_workspaces(id TEXT PRIMARY KEY,slot INTEGER UNIQUE NOT NULL,name TEXT NOT NULL,host TEXT UNIQUE NOT NULL,owner_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL)');
  const requireOwner=identity=>{if(!ownerId||identity?.user.id!==ownerId||!get('users',ownerId)?.active||db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(ownerId)?.role!=='admin')fail('CRM Owner access required',403);};
  const root=join(dirname(dbPath),'workspaces');
  const path=id=>{if(!/^[a-f0-9-]{36}$/.test(id))fail('Invalid workspace ID');return join(root,id,'crm.sqlite');};
  function list(identity){requireOwner(identity);return {capacity:WORKSPACE_SLOTS,current:{name:'Current workspace',url:mainOrigin,ownerId},workspaces:db.prepare('SELECT * FROM crm_workspaces ORDER BY slot').all().map(row=>({...row,url:'https://'+row.host}))};}
  function create(identity,input){
    requireOwner(identity);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120||typeof input.ownerName!=='string'||!input.ownerName.trim()||input.ownerName.length>120)fail('Workspace and owner names required');
    if(!/^[a-z0-9.@_+\-]{3,120}$/.test(String(input.ownerUsername||'')))fail('Owner username must be 3–120 lowercase letters/numbers or . @ _ + -');
    db.exec('BEGIN IMMEDIATE');let folder,tenant;
    try{
      const used=new Set(db.prepare('SELECT slot FROM crm_workspaces').all().map(row=>row.slot));let slot=1;while(used.has(slot))slot++;if(slot>WORKSPACE_SLOTS)fail('Workspace capacity reached; ask the CRM Owner to expand hosting capacity',409);
      const id=randomUUID(),host='salesdesk-ws'+String(slot).padStart(2,'0')+'.'+baseDomain,userId=randomUUID();
      folder=dirname(path(id));mkdirSync(folder,{recursive:true,mode:0o700});tenant=new DatabaseSync(path(id));tenant.exec('PRAGMA journal_mode=WAL;CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id));CREATE TABLE workspace_roles(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,permissions TEXT NOT NULL)');
      tenant.prepare('INSERT INTO records VALUES(?,?,?)').run('users',userId,JSON.stringify({id:userId,name:input.ownerName.trim(),role:'owner',active:true,createdAt:new Date().toISOString()}));
      const auth=createUserAuth({db:tenant,getUser:id=>{const row=tenant.prepare("SELECT body FROM records WHERE kind='users' AND id=?").get(id);return row?JSON.parse(row.body):null;}});
      auth.bootstrap({userId,username:input.ownerUsername,password:randomBytes(40).toString('base64url'),company:input.name.trim()});tenant.exec('DELETE FROM auth_sessions');
      tenant.prepare("INSERT INTO workspace_roles VALUES(?,'owner','{}')").run(userId);const reset=auth.issuePasswordReset(input.ownerUsername);
      db.prepare('INSERT INTO crm_workspaces VALUES(?,?,?,?,?,?,?)').run(id,slot,input.name.trim(),host,userId,'active',new Date().toISOString());tenant.close();tenant=null;chmodSync(path(id),0o600);db.exec('COMMIT');
      return {id,name:input.name.trim(),url:'https://'+host,ownerUsername:input.ownerUsername,setupUrl:'https://'+host+'/reset-password.html#token='+encodeURIComponent(reset.token),expiresAt:reset.expiresAt};
    }catch(error){try{tenant?.close();}catch{}db.exec('ROLLBACK');if(folder)rmSync(folder,{recursive:true,force:true});throw error;}
  }
  function setState(identity,id,state){requireOwner(identity);if(!['active','suspended'].includes(state))fail('Invalid workspace state');if(!db.prepare('UPDATE crm_workspaces SET state=? WHERE id=?').run(state,id).changes)fail('Workspace not found',404);return {updated:true};}
  function manage(identity,id,operation,input,userId){
    requireOwner(identity);const row=db.prepare('SELECT * FROM crm_workspaces WHERE id=?').get(id);if(!row)fail('Workspace not found',404);
    const tenant=new DatabaseSync(path(id));tenant.exec('PRAGMA busy_timeout=5000');
    try{
      const get=(kind,id)=>{const r=tenant.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.body):null;};
      const put=(kind,value)=>tenant.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,JSON.stringify(value));
      const owner=tenant.prepare("SELECT user_id FROM workspace_roles WHERE role='owner'").all().find(r=>get('users',r.user_id)?.active);if(!owner)fail('Workspace requires an active owner',409);
      const auth=createUserAuth({db:tenant,getUser:id=>get('users',id)}),access=createWorkspaceAccess({db:tenant,get,put,userAuth:auth,origin:'https://'+row.host,auditActorId:'crm-owner:'+identity.user.id}),actor={user:{id:owner.user_id,role:'admin'}};
      if(operation==='list')return access.list(actor);
      if(operation==='invite')return access.invite(actor,input);
      if(operation==='update')return access.update(actor,userId,input);
      if(operation==='reset')return access.reset(actor,userId);
      fail('Unknown user operation');
    }finally{tenant.close();}
  }
  return {list,create,setState,path,manage};
}
