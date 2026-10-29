import { randomBytes,randomUUID,createHash } from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const scopes=['leads:read','reports:read','insights:read','leads:edit','leads:assign','transcription:run','tasks:write'];
export function createMcpAccess({db,get,now=()=>Date.now(),canAdmin=()=>true}){
  db.exec('CREATE TABLE IF NOT EXISTS crm_mcp_keys(id TEXT PRIMARY KEY,hash TEXT UNIQUE,owner TEXT,label TEXT,scopes TEXT,expires INTEGER,revoked INTEGER DEFAULT 0)');
  const admin=id=>{if(!get('users',id)?.active||!canAdmin(id)||db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(id)?.role!=='admin')fail('Active workspace administrator required',403);};
  const digest=token=>createHash('sha256').update(token).digest('hex');
  const limits=new Map();
  return {
    list(identity){admin(identity.user.id);return db.prepare('SELECT id,owner,label,scopes,expires,revoked FROM crm_mcp_keys ORDER BY rowid DESC').all().map(row=>({...row,scopes:JSON.parse(row.scopes)}));},
    issue(identity,input,ttl=30*86400000){admin(identity.user.id);if(typeof input.label!=='string'||!input.label.trim()||input.label.length>100)fail('Connection name required');
      const selected=Array.isArray(input.scopes)?[...new Set(input.scopes)]:[];if(!selected.length||selected.some(scope=>!scopes.includes(scope)))fail('Choose valid permissions');
      const token='sdmcp_'+randomBytes(32).toString('base64url'),id=randomUUID(),expires=now()+ttl;
      db.prepare('INSERT INTO crm_mcp_keys VALUES(?,?,?,?,?,?,0)').run(id,digest(token),identity.user.id,input.label.trim(),JSON.stringify(selected),expires);
      return {id,token,expires};
    },
    revoke(identity,id){admin(identity.user.id);db.prepare('UPDATE crm_mcp_keys SET revoked=1 WHERE id=?').run(id);return {revoked:true};},
    authorize(header){const token=/^Bearer (sdmcp_[A-Za-z0-9_-]{43})$/.exec(header||'')?.[1];if(!token)fail('MCP bearer token required',401);
      const key=db.prepare('SELECT * FROM crm_mcp_keys WHERE hash=?').get(digest(token));if(!key||key.revoked||key.expires<=now())fail('MCP token expired or revoked',401);admin(key.owner);
      const window=Math.floor(now()/60000),entry=limits.get(key.id);if(entry?.window===window){if(entry.count++>=120)fail('MCP rate limit reached',429);}else limits.set(key.id,{window,count:1});
      return key;
    }
  };
}
