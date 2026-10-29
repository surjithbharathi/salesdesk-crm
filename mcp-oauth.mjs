import {randomUUID,randomBytes,createHash} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const readScopes=['leads:read','reports:read','insights:read'];
const allowed=[...readScopes,'leads:edit','leads:assign','transcription:run','tasks:write'];
export function createMcpOAuth({db,origin,access,now=()=>Date.now()}){
  db.exec('CREATE TABLE IF NOT EXISTS mcp_oauth_clients(id TEXT PRIMARY KEY,body TEXT);CREATE TABLE IF NOT EXISTS mcp_oauth_requests(id TEXT PRIMARY KEY,body TEXT,expires INTEGER,used INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS mcp_oauth_codes(hash TEXT PRIMARY KEY,body TEXT,expires INTEGER,used INTEGER DEFAULT 0)');
  db.exec('CREATE TABLE IF NOT EXISTS mcp_oauth_refresh(hash TEXT PRIMARY KEY,body TEXT,expires INTEGER,used INTEGER DEFAULT 0)');
  const resource=origin+'/mcp';
  const client=id=>{const row=db.prepare('SELECT body FROM mcp_oauth_clients WHERE id=?').get(id);if(!row)fail('Unknown OAuth client');return JSON.parse(row.body);};
  const pending=id=>{const row=db.prepare('SELECT * FROM mcp_oauth_requests WHERE id=?').get(id);if(!row||row.used||row.expires<=now())fail('Authorization request expired or already used');return JSON.parse(row.body);};
  const admin=identity=>{access.list(identity);};
  function issueTokens(identity,c,r,family=randomUUID(),expires=now()+7*86400000){
    const issued=access.issue(identity,{label:('OAuth · '+c.client_name).slice(0,100),scopes:r.scopes},3600000);
    const refresh=randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO mcp_oauth_refresh VALUES(?,?,?,0)').run(hash(refresh),JSON.stringify({client_id:c.client_id,owner:identity.user.id,keyId:issued.id,scopes:r.scopes,family,resource}),expires);
    return {access_token:issued.token,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:r.scopes.join(' ')};
  }
  return {
    metadata(){return {issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',registration_endpoint:origin+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],code_challenge_methods_supported:['S256'],scopes_supported:allowed};},
    resourceMetadata(){return {resource,authorization_servers:[origin],scopes_supported:allowed,bearer_methods_supported:['header']};},
    register(input){
      if(db.prepare('SELECT COUNT(*) AS n FROM mcp_oauth_clients').get().n>=2000)fail('Client registration limit reached',429);
      if(!Array.isArray(input.redirect_uris)||!input.redirect_uris.length||input.redirect_uris.length>5)fail('Register 1–5 redirect URIs');
      for(const uri of input.redirect_uris){let u;try{u=new URL(uri);}catch{fail('Invalid redirect URI');}if(uri.length>2000||u.hash||u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname))))fail('HTTPS redirect URI required (HTTP loopback permitted)');}
      const method=input.token_endpoint_auth_method||'client_secret_post';if(!['none','client_secret_post','client_secret_basic'].includes(method))fail('Unsupported client authentication');
      if(input.grant_types?.some(value=>!['authorization_code','refresh_token'].includes(value)))fail('Unsupported grant type');
      if(input.response_types?.some(value=>value!=='code'))fail('Only code response type is supported');
      const id=randomUUID(),secret=method==='none'?undefined:randomBytes(32).toString('base64url');
      const c={client_id:id,client_name:String(input.client_name||'MCP client').slice(0,100),redirect_uris:input.redirect_uris,token_endpoint_auth_method:method,secretHash:secret?hash(secret):null};
      db.prepare('INSERT INTO mcp_oauth_clients VALUES(?,?)').run(id,JSON.stringify(c));
      return {...c,secretHash:undefined,client_secret:secret,client_id_issued_at:Math.floor(now()/1000),grant_types:['authorization_code','refresh_token'],response_types:['code']};
    },
    authorize(query){
      const c=client(query.client_id);if(!c.redirect_uris.includes(query.redirect_uri))fail('Redirect URI must exactly match registration');
      if(query.response_type!=='code'||query.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge||''))fail('Authorization code with PKCE S256 is required');
      if(query.resource&&query.resource!==resource)fail('Invalid MCP resource');
      if(typeof query.state!=='string'||query.state.length>2000)fail('OAuth state required');
      const scopes=query.scope?query.scope.split(' ').filter(Boolean):readScopes;
      if(!scopes.length||scopes.some(scope=>!allowed.includes(scope)))fail('Invalid scope');
      db.prepare('DELETE FROM mcp_oauth_requests WHERE expires<=?').run(now());db.prepare('DELETE FROM mcp_oauth_codes WHERE expires<=?').run(now());
      if(db.prepare('SELECT COUNT(*) AS n FROM mcp_oauth_requests WHERE used=0').get().n>=200)fail('Too many pending requests',429);
      const id=randomUUID(),request={client_id:c.client_id,client_name:c.client_name,redirect_uri:query.redirect_uri,state:query.state,challenge:query.code_challenge,scopes,resource};
      db.prepare('INSERT INTO mcp_oauth_requests VALUES(?,?,?,0)').run(id,JSON.stringify(request),now()+600000);
      return origin+'/#mcp?oauth_request='+id;
    },
    consent(identity,id){admin(identity);const r=pending(id);return {id,clientName:r.client_name,redirectUri:r.redirect_uri,scopes:r.scopes};},
    decide(identity,id,approved){
      admin(identity);const request=pending(id);
      const changed=db.prepare('UPDATE mcp_oauth_requests SET used=1 WHERE id=? AND used=0').run(id);if(!changed.changes)fail('Authorization request already used');
      const redirect=new URL(request.redirect_uri);redirect.searchParams.set('state',request.state);
      if(!approved){redirect.searchParams.set('error','access_denied');return {redirect:redirect.href};}
      const code=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO mcp_oauth_codes VALUES(?,?,?,0)').run(hash(code),JSON.stringify({...request,owner:identity.user.id}),now()+120000);
      redirect.searchParams.set('code',code);return {redirect:redirect.href};
    },
    token(input,authorization){
      if(!['authorization_code','refresh_token'].includes(input.grant_type))fail('unsupported_grant_type');
      let clientId=input.client_id,secret=input.client_secret,method='client_secret_post';
      if(authorization?.startsWith('Basic ')){let decoded;try{decoded=Buffer.from(authorization.slice(6),'base64').toString();}catch{fail('invalid_client',401);}const i=decoded.indexOf(':');clientId=decodeURIComponent(decoded.slice(0,i));secret=decodeURIComponent(decoded.slice(i+1));method='client_secret_basic';}
      const c=client(clientId);
      if(c.token_endpoint_auth_method!=='none'&&(method!==c.token_endpoint_auth_method||typeof secret!=='string'||hash(secret)!==c.secretHash))fail('invalid_client',401);
      if(input.grant_type==='refresh_token'){
        const row=db.prepare('SELECT * FROM mcp_oauth_refresh WHERE hash=?').get(hash(String(input.refresh_token||'')));
        if(!row||row.expires<=now())fail('invalid_grant');const r=JSON.parse(row.body);
        if(r.client_id!==clientId||(input.resource&&input.resource!==resource))fail('invalid_grant');
        const identity={user:{id:r.owner,role:'admin'}};admin(identity);
        if(row.used){for(const entry of db.prepare('SELECT body FROM mcp_oauth_refresh').all()){const old=JSON.parse(entry.body);if(old.family===r.family)access.revoke(identity,old.keyId);}fail('invalid_grant');}
        const current=db.prepare('SELECT revoked,expires FROM crm_mcp_keys WHERE id=?').get(r.keyId);if(!current||current.revoked)fail('invalid_grant');
        if(input.scope){const scopes=input.scope.split(' ').filter(Boolean);if(!scopes.length||scopes.some(scope=>!r.scopes.includes(scope)))fail('invalid_scope');r.scopes=scopes;}
        db.exec('BEGIN IMMEDIATE');try{
          if(!db.prepare('UPDATE mcp_oauth_refresh SET used=1 WHERE hash=? AND used=0').run(row.hash).changes)fail('invalid_grant');
          access.revoke(identity,r.keyId);const issued=issueTokens(identity,c,r,r.family,row.expires);db.exec('COMMIT');return issued;
        }catch(error){db.exec('ROLLBACK');throw error;}
      }
      const row=db.prepare('SELECT * FROM mcp_oauth_codes WHERE hash=?').get(hash(String(input.code||'')));
      if(!row||row.used||row.expires<=now())fail('invalid_grant');const r=JSON.parse(row.body);
      if(r.client_id!==clientId||r.redirect_uri!==input.redirect_uri||(input.resource&&input.resource!==resource)||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier||'')||createHash('sha256').update(input.code_verifier).digest('base64url')!==r.challenge)fail('invalid_grant');
      const identity={user:{id:r.owner,role:'admin'}};admin(identity);
      db.exec('BEGIN IMMEDIATE');try{
        if(!db.prepare('UPDATE mcp_oauth_codes SET used=1 WHERE hash=? AND used=0').run(row.hash).changes)fail('invalid_grant');
        const issued=issueTokens(identity,c,r);db.exec('COMMIT');return issued;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  };
}
