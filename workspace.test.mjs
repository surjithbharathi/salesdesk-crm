import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createUserAuth} from './user-auth.mjs';
import {createWorkspaceAccess} from './workspace-access.mjs';
import {createWorkspaceRegistry} from './workspace-registry.mjs';
function fixture(){
 const folder=mkdtempSync(join(process.env.SALESDESK_TEST_TMP||tmpdir(),'workspace-test-')),path=join(folder,'crm.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))');
 const get=(kind,id)=>{const row=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.body):null;};
 const put=(kind,value)=>db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,JSON.stringify(value));
 const ownerId=randomUUID();put('users',{id:ownerId,name:'Synthetic owner',active:true});const auth=createUserAuth({db,getUser:id=>get('users',id)});
 const login=auth.bootstrap({userId:ownerId,username:'test-owner',password:'Synthetic-owner-password-123',company:'Test workspace'}),identity={user:login.user};
 const access=createWorkspaceAccess({db,get,put,userAuth:auth,crmOwnerId:ownerId,origin:'https://salesdesk-crm.example'});
 const registry=createWorkspaceRegistry({db,dbPath:path,ownerId,get,baseDomain:'example',mainOrigin:'https://salesdesk-crm.example'});
 return {db,auth,get,put,access,registry,identity,ownerId,close(){db.close();rmSync(folder,{recursive:true});}};
}
test('workspace databases, owners and setup/login sessions stay isolated',()=>{
 const f=fixture();try{
  const a=f.registry.create(f.identity,{name:'Workspace A',ownerName:'A Owner',ownerUsername:'a-owner'}),b=f.registry.create(f.identity,{name:'Workspace B',ownerName:'B Owner',ownerUsername:'b-owner'});
  assert.notEqual(f.registry.path(a.id),f.registry.path(b.id));assert.equal(new URL(a.url).hostname,'salesdesk-ws01.example');
  const tenant=new DatabaseSync(f.registry.path(a.id));try{
   assert.equal(tenant.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='leads'").get().n,0);
   const auth=createUserAuth({db:tenant,getUser:id=>{const row=tenant.prepare("SELECT body FROM records WHERE kind='users' AND id=?").get(id);return row?JSON.parse(row.body):null;}});
   auth.resetPassword({token:new URLSearchParams(new URL(a.setupUrl).hash.slice(1)).get('token'),password:'Workspace-A-owner-password-123'});
   const session=auth.login({username:'a-owner',password:'Workspace-A-owner-password-123'});assert.throws(()=>f.auth.authenticate(session.token),/session/);
   assert.throws(()=>f.registry.list({user:session.user}),/CRM Owner/);
  }finally{tenant.close();}
  assert.equal(f.registry.list(f.identity).workspaces.length,2);
  f.registry.setState(f.identity,a.id,'suspended');assert.equal(f.registry.list(f.identity).workspaces[0].state,'suspended');
 }finally{f.close();}
});
test('roles, permission updates, session revocation and owner lockout prevention',()=>{
 const f=fixture();try{
  const invited=f.access.invite(f.identity,{name:'Synthetic viewer',username:'test-viewer',role:'viewer'});
  f.auth.resetPassword({token:new URLSearchParams(new URL(invited.setupUrl).hash.slice(1)).get('token'),password:'Synthetic-viewer-password-123'});
  const previousSession=f.auth.login({username:'test-viewer',password:'Synthetic-viewer-password-123'});
  assert.equal(f.access.can(invited.userId,'leads.write'),false);assert.equal(f.access.can(invited.userId,'calls.read'),true);
  assert.throws(()=>f.access.invite({user:{id:invited.userId,role:'member'}},{name:'Escalation',username:'escalation',role:'owner'}),/Permission/);
  assert.throws(()=>f.access.update(f.identity,f.ownerId,{role:'member',active:false,permissions:{}}),/CRM Owner/);
  assert.throws(()=>f.access.update(f.identity,invited.userId,{role:'viewer',active:true,permissions:{'leads.write':true}}),/read-only/);
  f.access.update(f.identity,invited.userId,{role:'member',active:true,permissions:{'calls.read':false}});assert.equal(f.access.can(invited.userId,'calls.read'),false);assert.equal(f.access.can(invited.userId,'leads.write'),true);
  assert.throws(()=>f.auth.authenticate(previousSession.token),/session/);
  const admin=f.access.invite(f.identity,{name:'Admin',username:'test-admin',role:'admin'});
  assert.throws(()=>f.access.update({user:{id:admin.userId,role:'admin'}},f.ownerId,{role:'member',active:true}),/Only a Workspace Owner/);
  assert.throws(()=>f.access.update(f.identity,invited.userId,{role:'member',active:true,permissions:{'users.manage':true}}),/Administrator permissions/);
  f.access.update(f.identity,admin.userId,{role:'admin',active:true,permissions:{'integrations.manage':false}});
  const limited={user:{id:admin.userId,role:'admin'}};
  assert.throws(()=>f.access.update(limited,admin.userId,{role:'admin',active:true,permissions:{'integrations.manage':true}}),/beyond your own/);
  assert.throws(()=>f.access.invite(limited,{name:'Escalated admin',username:'escalated-admin',role:'admin'}),/beyond your own/);
 }finally{f.close();}
});
test('CRM Owner can manage tenant users with explicit cross-workspace audit attribution',()=>{
 const f=fixture();try{
  const workspace=f.registry.create(f.identity,{name:'Managed',ownerName:'Owner',ownerUsername:'managed-owner'});
  const user=f.registry.manage(f.identity,workspace.id,'invite',{name:'Managed member',username:'managed-member',role:'member'});
  const users=f.registry.manage(f.identity,workspace.id,'list');assert.ok(users.some(row=>row.id===user.userId&&row.role==='member'));
  const owner=users.find(row=>row.role==='owner');assert.throws(()=>f.registry.manage(f.identity,workspace.id,'update',{role:'member',active:true,permissions:{}},owner.id),/at least one/);
  const tenant=new DatabaseSync(f.registry.path(workspace.id));try{assert.equal(tenant.prepare("SELECT actor FROM workspace_access_audit WHERE action='user.invited'").get().actor,'crm-owner:'+f.ownerId);}finally{tenant.close();}
 }finally{f.close();}
});

test('Manager hierarchy and team scope cannot elevate into administration',()=>{
 const f=fixture();try{
  const manager=f.access.invite(f.identity,{name:'Manager',username:'test-manager',role:'manager'});
  assert.equal(f.access.profile(manager.userId).role,'manager');
  assert.equal(f.db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(manager.userId).role,'admin');
  assert.equal(f.access.can(manager.userId,'leads.write'),true);
  assert.equal(f.access.can(manager.userId,'users.manage'),false);
  assert.equal(f.access.can(manager.userId,'integrations.manage'),false);
  assert.throws(()=>f.access.update(f.identity,manager.userId,{role:'manager',active:true,permissions:{'users.manage':true}}),/Administrator permissions/);
  assert.throws(()=>f.access.invite({user:{id:manager.userId}},{name:'Admin',username:'escalate-admin',role:'admin'}),/Permission/);
 }finally{f.close();}
});
