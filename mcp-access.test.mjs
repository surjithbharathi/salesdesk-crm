import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMcpAccess} from './mcp-access.mjs';
test('MCP tokens are hashed, administrator-bound, expiring and revocable',()=>{
  const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE auth_accounts(user_id TEXT,role TEXT);INSERT INTO auth_accounts VALUES('a','admin');");
  let active=true,time=100000;const identity={user:{id:'a',role:'admin'}},access=createMcpAccess({db,get:()=>({active}),now:()=>time});
  try{
    const token=access.issue(identity,{label:'Test client',scopes:['leads:read']});
    assert.equal(access.authorize('Bearer '+token.token).owner,'a');
    assert.equal(JSON.stringify(access.list(identity)).includes(token.token),false);
    assert.notEqual(db.prepare('SELECT hash FROM crm_mcp_keys').get().hash,token.token);
    active=false;assert.throws(()=>access.authorize('Bearer '+token.token),/administrator/);active=true;
    access.revoke(identity,token.id);assert.throws(()=>access.authorize('Bearer '+token.token),/revoked/);
    const next=access.issue(identity,{label:'Expires',scopes:['leads:read']});time+=31*86400000;assert.throws(()=>access.authorize('Bearer '+next.token),/expired/);
  }finally{db.close();}
});
