import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function phoneParts(value, countryCode = '') {
  const raw=String(value ?? '').trim(),code=String(countryCode ?? '').replace(/^\+/,'').trim();
  if(!raw)return {phone:'',countryCode:'',mobileNumber:'',phoneKey:''};
  if(!/^[+\d ()-]{7,40}$/.test(raw) || (code&&!/^[1-9]\d{0,2}$/.test(code)))throw Object.assign(Error('Enter a valid country code and mobile number'),{status:400});
  let digits=raw.replace(/\D/g,''),international=raw.startsWith('+')||raw.startsWith('00');
  if(raw.startsWith('00'))digits=digits.slice(2);
  let input;
  if(international)input='+'+digits;
  else if(code){
    if(code==='91'&&digits.length===12&&digits.startsWith('91'))input='+'+digits;
    else input='+'+code+digits;
  }else if(digits.length===12&&digits.startsWith('91'))input='+'+digits;
  else input=raw;
  const parsed=parsePhoneNumberFromString(input,{defaultCountry:'IN',extract:false});
  if(!parsed||!parsed.isPossible()||parsed.ext||(code&&parsed.countryCallingCode!==code))throw Object.assign(Error('Enter a valid country code and mobile number'),{status:400});
  return {phone:parsed.number,countryCode:parsed.countryCallingCode,mobileNumber:parsed.nationalNumber,phoneKey:parsed.number.slice(1)};
}
export function phoneKeyOf(record){try{return phoneParts(record.phone || record.mobileNumber,record.phone?'':record.countryCode).phoneKey;}catch{return '';}}
export function assertUniqueLead(all,record){
  const key=phoneKeyOf(record);if(!key)return;
  if(all('leads').some(lead=>lead.id!==record.id&&!lead.mergedInto&&phoneKeyOf(lead)===key))throw Object.assign(Error('A lead already exists with this mobile number. Open the existing lead instead.'),{status:409});
}
export function initializeLeadPhoneIndex(db){
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of db.prepare("SELECT id,body FROM records WHERE kind='leads'").all()){
      const lead=JSON.parse(row.body);let parts;try{parts=phoneParts(lead.phone);}catch{continue;}
      db.prepare("UPDATE records SET body=? WHERE kind='leads' AND id=?").run(JSON.stringify({...lead,...parts}),row.id);
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS unique_lead_mobile ON records(json_extract(body,'$.phoneKey')) WHERE kind='leads' AND json_extract(body,'$.phoneKey')<>''");
    db.exec('COMMIT');return true;
  }catch(error){db.exec('ROLLBACK');if(error.errcode===2067||/UNIQUE constraint failed/.test(error.message))return false;throw error;}
}
