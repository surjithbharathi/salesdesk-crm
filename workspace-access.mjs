import {randomUUID,randomBytes} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const PERMISSIONS=['leads.write','tasks.write','calls.read','calls.sync','messages.read','reports.read','integrations.manage','users.manage','data.export'];
export function createWorkspaceAccess({db,get,put,userAuth,crmOwnerId='',origin='',auditActorId=''}){
  db.exec('CREATE TABLE IF NOT EXISTS workspace_roles(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,permissions TEXT NOT NULL);CREATE TABLE IF NOT EXISTS workspace_access_audit(id TEXT PRIMARY KEY,actor TEXT,target TEXT,action TEXT,at TEXT)');
  if(crmOwnerId&&get('users',crmOwnerId))db.prepare("INSERT OR IGNORE INTO workspace_roles VALUES(?,'owner','{}')").run(crmOwnerId);
  const rank=role=>({owner:4,admin:3,manager:2,member:1,viewer:0}[role]??0);
  const hierarchy=(actor,targetRole)=>{if(rank(targetRole)>rank(actor.role))fail('Cannot manage a role above your own',403);};
  const defaults=role=>Object.fromEntries(PERMISSIONS.map(key=>[key,role==='owner'||role==='admin'||(!['integrations.manage','users.manage','data.export'].includes(key)&&(role!=='viewer'||['calls.read','messages.read','reports.read'].includes(key)))]));
  function profile(id){
    const account=db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(id),row=db.prepare('SELECT role,permissions FROM workspace_roles WHERE user_id=?').get(id);
    const role=row?.role||(account?.role==='admin'?'admin':'member');
    return {role,permissions:{...defaults(role),...(role==='owner'?{}:JSON.parse(row?.permissions||'{}'))},crmOwner:id===crmOwnerId};
  }
  const can=(id,permission)=>Boolean(get('users',id)?.active&&profile(id).permissions[permission]);
  const requirePermission=(identity,permission)=>{if(!identity||!can(identity.user.id,permission))fail('Permission required: '+permission,403);};
  const audit=(actor,target,action)=>db.prepare('INSERT INTO workspace_access_audit VALUES(?,?,?,?,?)').run(randomUUID(),auditActorId||actor,target,action,new Date().toISOString());
  const withinAuthority=(actor,permissions)=>{if(actor.role!=='owner'&&PERMISSIONS.some(key=>permissions[key]&&!actor.permissions[key]))fail('Workspace Owner must manage permissions beyond your own access',403);};
  function list(identity){requirePermission(identity,'users.manage');const accounts=userAuth.listAccounts();return db.prepare("SELECT body FROM records WHERE kind='users'").all().map(row=>{const user=JSON.parse(row.body),account=accounts.find(account=>account.id===user.id);return {id:user.id,name:user.name,username:account?.username||'',email:user.email||'',active:Boolean(user.active),hasLogin:Boolean(account),...profile(user.id)};});}
  function invite(identity,input){
    requirePermission(identity,'users.manage');
    if(!['owner','admin','manager','member','viewer'].includes(input.role))fail('Choose a valid workspace role');
    if(input.role==='owner'&&profile(identity.user.id).role!=='owner')fail('Only a Workspace Owner can add another owner',403);
    hierarchy(profile(identity.user.id),input.role);withinAuthority(profile(identity.user.id),defaults(input.role));
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)fail('User name required');
    if(input.email&&!(typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)))fail('Valid email required');
    if(input.sendEmail&&!input.email)fail('Recipient email required');
    const existing=input.userId?get('users',input.userId):null;
    if(input.userId&&(!existing||db.prepare('SELECT 1 FROM auth_accounts WHERE user_id=?').get(input.userId)))fail('Select an existing user without login');
    const id=existing?.id||randomUUID();db.exec('BEGIN IMMEDIATE');try{
      put('users',{...existing,id,name:input.name.trim(),email:input.email||existing?.email||'',role:input.role,active:true,createdAt:existing?.createdAt||new Date().toISOString()});
      userAuth.createAccount(identity,{userId:id,username:input.username,password:randomBytes(40).toString('base64url')});
      db.prepare('UPDATE auth_accounts SET role=? WHERE user_id=?').run(['owner','admin','manager'].includes(input.role)?'admin':'member',id);
      db.prepare('INSERT INTO workspace_roles VALUES(?,?,?)').run(id,input.role,'{}');audit(identity.user.id,id,'user.invited');db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const reset=userAuth.issuePasswordReset(input.username);return {userId:id,username:reset.user.username,setupUrl:origin+'/reset-password.html#token='+encodeURIComponent(reset.token),expiresAt:reset.expiresAt};
  }
  function update(identity,id,input){
    requirePermission(identity,'users.manage');const current=get('users',id),account=db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(id);if(!current||!account)fail('Workspace user not found',404);
    const previous=profile(id),actor=profile(identity.user.id);
    if((previous.role==='owner'||input.role==='owner')&&actor.role!=='owner')fail('Only a Workspace Owner can change owner access',403);
    hierarchy(actor,previous.role);hierarchy(actor,input.role);withinAuthority(actor,previous.permissions);
    if(!['owner','admin','manager','member','viewer'].includes(input.role)||typeof input.active!=='boolean')fail('Valid role and active flag required');
    if(id===crmOwnerId&&(!input.active||input.role!=='owner'))fail('CRM Owner must remain active as Workspace Owner');
    if(previous.role==='owner'&&(!input.active||input.role!=='owner')){
      const owners=db.prepare("SELECT user_id FROM workspace_roles WHERE role='owner' AND user_id<>?").all(id).filter(row=>get('users',row.user_id)?.active);if(!owners.length)fail('Keep at least one active Workspace Owner');
    }
    if(input.email!==undefined&&!(typeof input.email==='string'&&(!input.email||input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))))fail('Valid email required');
    const permissions=input.permissions||{};if(typeof permissions!=='object'||Array.isArray(permissions)||Object.entries(permissions).some(([key,value])=>!PERMISSIONS.includes(key)||typeof value!=='boolean'))fail('Invalid permissions');
    if(['manager','member','viewer'].includes(input.role)&&['users.manage','integrations.manage','data.export'].some(key=>permissions[key]))fail('Administrator permissions require the admin role');
    if(input.role==='viewer'&&['leads.write','tasks.write','calls.sync'].some(key=>permissions[key]))fail('Viewer role is read-only');
    withinAuthority(actor,{...defaults(input.role),...permissions});
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('INSERT INTO workspace_roles VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,permissions=excluded.permissions').run(id,input.role,JSON.stringify(permissions));
      db.prepare('UPDATE auth_accounts SET role=? WHERE user_id=?').run(['owner','admin','manager'].includes(input.role)?'admin':'member',id);
      put('users',{...current,email:input.email===undefined?current.email:input.email,active:input.active,role:input.role,updatedAt:new Date().toISOString()});
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM auth_resets WHERE user_id=?').run(id);audit(identity.user.id,id,'access.updated');db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {updated:true};
  }
  function reset(identity,id){requirePermission(identity,'users.manage');const actor=profile(identity.user.id),target=profile(id);if(target.role==='owner'&&actor.role!=='owner')fail('Only a Workspace Owner can reset owner access',403);withinAuthority(actor,target.permissions);hierarchy(actor,target.role);const account=db.prepare('SELECT username FROM auth_accounts WHERE user_id=?').get(id);if(!account)fail('User not found',404);const value=userAuth.issuePasswordReset(account.username);audit(identity.user.id,id,'setup_link.created');return {setupUrl:origin+'/reset-password.html#token='+encodeURIComponent(value.token),expiresAt:value.expiresAt};}
  return {profile,can,requirePermission,list,invite,update,reset};
}
