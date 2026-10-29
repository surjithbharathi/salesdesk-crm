import {DatabaseSync} from 'node:sqlite';
import {createUserAuth} from '/app/user-auth.mjs';
const db=new DatabaseSync('/app/data/smoke.sqlite');db.exec('CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))');
const id='00000000-0000-4000-8000-000000000001';
db.prepare('INSERT INTO records VALUES(?,?,?)').run('users',id,JSON.stringify({id,name:'Synthetic CRM Owner',active:true}));
const auth=createUserAuth({db,getUser:id=>{const row=db.prepare("SELECT body FROM records WHERE kind='users' AND id=?").get(id);return row?JSON.parse(row.body):null;}});
auth.bootstrap({userId:id,username:'fixture-owner',password:'Synthetic-Workspace-HTTP-123',company:'Isolated test'});db.close();
