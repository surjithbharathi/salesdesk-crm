import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createMcpAccess} from './mcp-access.mjs';
import {createMcpOAuth} from './mcp-oauth.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE auth_accounts(user_id TEXT,role TEXT);INSERT INTO auth_accounts VALUES('admin','admin');");let time=100000;
 const access=createMcpAccess({db,get:()=>({active:true}),now:()=>time}),oauth=createMcpOAuth({db,origin:'https://crm.example',access,now:()=>time});
 const identity={user:{id:'admin',role:'admin'}},verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
 const client=oauth.register({client_name:'Test client',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'});
 const query={client_id:client.client_id,redirect_uri:'https://client.example/callback',response_type:'code',code_challenge_method:'S256',code_challenge:challenge,state:'nonce',resource:'https://crm.example/mcp'};
 return {db,access,oauth,identity,verifier,client,query,advance:()=>{time+=3600001;}};
}
test('OAuth registration, explicit consent, PKCE exchange and short-lived MCP access',()=>{
 const f=fixture();try{
  const consent=new URL(f.oauth.authorize(f.query)),id=new URLSearchParams(consent.hash.split('?')[1]).get('oauth_request');
  assert.equal(f.access.list(f.identity).length,0);assert.equal(f.oauth.consent(f.identity,id).clientName,'Test client');
  const callback=new URL(f.oauth.decide(f.identity,id,true).redirect);assert.equal(callback.searchParams.get('state'),'nonce');
  const input={grant_type:'authorization_code',client_id:f.client.client_id,redirect_uri:f.query.redirect_uri,code:callback.searchParams.get('code'),code_verifier:f.verifier,resource:f.query.resource};
  assert.throws(()=>f.oauth.token({...input,code_verifier:'wrong'.repeat(10)}),/invalid_grant/);
  assert.throws(()=>f.oauth.token({...input,resource:'https://other.example/mcp'}),/invalid_grant/);
  const result=f.oauth.token(input);assert.equal(result.expires_in,3600);assert.equal(f.access.authorize('Bearer '+result.access_token).owner,'admin');
  assert.throws(()=>f.oauth.token(input),/invalid_grant/);f.advance();assert.throws(()=>f.access.authorize('Bearer '+result.access_token),/expired/);
 }finally{f.db.close();}
});
test('OAuth rejects redirect changes, missing PKCE and unsafe registration; denial issues no token',()=>{
 const f=fixture();try{
  assert.throws(()=>f.oauth.register({redirect_uris:['http://attacker.example/callback']}),/HTTPS/);
  assert.throws(()=>f.oauth.authorize({...f.query,redirect_uri:'https://other.example/callback'}),/exactly/);
  assert.throws(()=>f.oauth.authorize({...f.query,code_challenge_method:'plain'}),/PKCE/);
  const url=new URL(f.oauth.authorize(f.query)),id=new URLSearchParams(url.hash.split('?')[1]).get('oauth_request');
  const callback=new URL(f.oauth.decide(f.identity,id,false).redirect);assert.equal(callback.searchParams.get('error'),'access_denied');assert.equal(f.access.list(f.identity).length,0);
  assert.throws(()=>f.oauth.decide(f.identity,id,true),/already used/);
 }finally{f.db.close();}
});
test('OAuth refresh rotates tokens, preserves scopes and blocks replay/revoked connections',()=>{
 const f=fixture();try{
  const url=new URL(f.oauth.authorize(f.query)),id=new URLSearchParams(url.hash.split('?')[1]).get('oauth_request');
  const callback=new URL(f.oauth.decide(f.identity,id,true).redirect),first=f.oauth.token({grant_type:'authorization_code',client_id:f.client.client_id,redirect_uri:f.query.redirect_uri,code:callback.searchParams.get('code'),code_verifier:f.verifier});
  const input={grant_type:'refresh_token',client_id:f.client.client_id,refresh_token:first.refresh_token};
  assert.throws(()=>f.oauth.token({...input,scope:'leads:edit'}),/invalid_scope/);
  const next=f.oauth.token(input);assert.notEqual(next.refresh_token,first.refresh_token);assert.equal(next.scope,first.scope);
  assert.throws(()=>f.access.authorize('Bearer '+first.access_token),/revoked/);
  assert.equal(f.access.authorize('Bearer '+next.access_token).owner,'admin');
  assert.throws(()=>f.oauth.token(input),/invalid_grant/);
  assert.throws(()=>f.access.authorize('Bearer '+next.access_token),/revoked/);
  assert.throws(()=>f.oauth.token({...input,refresh_token:next.refresh_token}),/invalid_grant/);
 }finally{f.db.close();}
});
