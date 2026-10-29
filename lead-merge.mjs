import {randomUUID} from 'node:crypto';
import {phoneKeyOf} from './lead-phone.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function mergeLeads({db,targetId,sourceIds,actorId,admin=false}){
  if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>20||new Set(sourceIds).size!==sourceIds.length||sourceIds.includes(targetId))fail('Choose a primary lead and different duplicate leads');
  const get=id=>{const row=db.prepare("SELECT body FROM records WHERE kind='leads' AND id=?").get(id);return row?JSON.parse(row.body):null;};
  const target=get(targetId),sources=sourceIds.map(get);
  if(!target||sources.some(l=>!l))fail('Lead not found',404);
  if(target.archived)fail('Restore the primary lead before merging');
  const key=phoneKeyOf(target);
  if(!key||sources.some(l=>phoneKeyOf(l)!==key))fail('Only leads with the same mobile number can be merged');
  if(!admin&&[target,...sources].some(l=>l.owner!==actorId))fail('You can only merge your assigned leads',403);
  db.exec('BEGIN IMMEDIATE');
  try{
    // Recheck after acquiring the write lock so edits cannot race the merge.
    if([target,...sources].some(l=>JSON.stringify(get(l.id))!==JSON.stringify(l)))fail('Leads changed. Refresh and review again',409);
    const time=new Date().toISOString(),mergeId=randomUUID(),snapshots=[target,...sources],counts={};
    const update=db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?');
    for(const row of db.prepare('SELECT kind,id,body FROM records').all()){
      if(row.kind==='leads'||row.kind==='leadAliases'||row.kind==='leadMerges')continue;
      const value=JSON.parse(row.body);let changed=false;
      if(sourceIds.includes(value.leadId)){value.leadId=targetId;changed=true;}
      if(Array.isArray(value.leadIds)&&value.leadIds.some(id=>sourceIds.includes(id))){value.leadIds=[...new Set(value.leadIds.map(id=>sourceIds.includes(id)?targetId:id))];changed=true;}
      if(changed){update.run(JSON.stringify(value),row.kind,row.id);counts[row.kind]=(counts[row.kind]||0)+1;}
    }
    const insert=db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?)');
    for(const source of sources){insert.run('leadAliases',source.id,JSON.stringify({id:source.id,targetId,mergeId,mergedAt:time,original:source}));db.prepare("DELETE FROM records WHERE kind='leads' AND id=?").run(source.id);}
    // Keep primary owner, source and stage. Fill empty descriptive fields only.
    const combined={...target,updatedAt:time};for(const field of ['company','email','city','disposition'])if(!combined[field])combined[field]=sources.map(l=>l[field]).find(Boolean)||combined[field]||'';
    update.run(JSON.stringify(combined),'leads',targetId);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='call_commands'").get())for(const sourceId of sourceIds)db.prepare("UPDATE call_commands SET status='Cancelled' WHERE lead_id=? AND status='Pending'").run(sourceId);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_receipts'").get())for(const sourceId of sourceIds)db.prepare("UPDATE integration_receipts SET record_id=? WHERE kind='leads' AND record_id=?").run(targetId,sourceId);
    const audit={id:mergeId,targetId,sourceIds,actorId,createdAt:time,counts,originals:snapshots};insert.run('leadMerges',mergeId,JSON.stringify(audit));
    const activity={id:randomUUID(),leadId:targetId,type:'System',text:`Merged ${sources.length} duplicate lead${sources.length===1?'':'s'}; calls and notes retained`,createdAt:time,updatedAt:time,userId:actorId,mergeId};insert.run('activities',activity.id,JSON.stringify(activity));
    db.exec('COMMIT');return {leadId:targetId,merged:sources.length,moved:counts,mergeId};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
