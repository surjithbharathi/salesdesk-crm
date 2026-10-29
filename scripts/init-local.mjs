// Synthetic, local-only initializer. Never use with a copied production database.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
if(process.env.CRM_DB||process.env.PUBLIC_ORIGIN||process.env.NODE_ENV==='production')throw Error('Local initializer refuses production/custom database settings');
const path=fileURLToPath(new URL('../data/crm.sqlite',import.meta.url));
const env=fileURLToPath(new URL('../.env.local',import.meta.url));
if(existsSync(path)||existsSync(env))throw Error('Local database or environment already exists; nothing changed');
mkdirSync(new URL('../data/',import.meta.url),{recursive:true,mode:0o700});
const db=new DatabaseSync(path),id=randomUUID();chmodSync(path,0o600);
try{db.exec('CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id)); CREATE TABLE workspace_roles(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,permissions TEXT NOT NULL)');db.prepare("INSERT INTO workspace_roles VALUES(?,'owner','{}')").run(id);db.prepare('INSERT INTO records VALUES(?,?,?)').run('users',id,JSON.stringify({id,name:'Local Administrator',role:'owner',active:true}));}finally{db.close();}
writeFileSync(env,`export CRM_OWNER_USER_ID='${id}'\n`,{flag:'wx',mode:0o600});
console.log('Synthetic local user created. Run: . ./.env.local && node server.mjs');
console.log('Then open http://localhost:3100 to choose a development username and password.');
