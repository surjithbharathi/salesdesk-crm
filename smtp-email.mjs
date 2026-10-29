import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve4} from 'node:dns/promises';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const email=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
export function publicIPv4(ip){const a=ip.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&![0,10,127].includes(a[0])&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&[0,168].includes(a[1]))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&[18,19].includes(a[1]))&&a[0]<224;}
export function createSmtpEmail({db,keyPath,origin,transportFactory,lookup=resolve4,now=Date.now}){
 try{writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}chmodSync(keyPath,0o600);const key=readFileSync(keyPath);
 db.exec('CREATE TABLE IF NOT EXISTS smtp_settings(id INTEGER PRIMARY KEY CHECK(id=1),body BLOB); CREATE TABLE IF NOT EXISTS smtp_delivery(id INTEGER PRIMARY KEY,actor TEXT,purpose TEXT,status TEXT,at INTEGER)');
 const raw=()=>{const r=db.prepare('SELECT body FROM smtp_settings WHERE id=1').get();if(!r)return {host:'smtp.hostinger.com',port:465,fromName:'Salesdesk CRM',enabled:false};const b=Buffer.from(r.body),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]));};
 const settings=()=>{const {password,...safe}=raw();return {...safe,hasPassword:Boolean(password)};};
 function save(input){const old=raw(),c={enabled:input.enabled===true,host:String(input.host||'').trim().toLowerCase(),port:Number(input.port),username:String(input.username||'').trim(),password:input.password||old.password||'',fromEmail:String(input.fromEmail||'').trim(),fromName:String(input.fromName||'Salesdesk CRM').trim()};
 if(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(c.host)||!c.host.includes('.')||/^\d+\./.test(c.host)||c.host.endsWith('.local')||!['465','587'].includes(String(c.port)))fail('Use a public SMTP hostname and port 465 or 587');
 if(!email(c.username)||!email(c.fromEmail)||c.fromName.length>100||/[\r\n]/.test(c.fromName)||typeof c.password!=='string'||c.password.length>500)fail('Enter valid sender and SMTP account details');
 if(c.enabled&&!c.password)fail('SMTP password required');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(JSON.stringify(c)),cipher.final()]);db.prepare('INSERT INTO smtp_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(Buffer.concat([iv,cipher.getAuthTag(),bytes]));return settings();}
 let sending=false,lastSend=0;
 async function send({to,purpose,setupUrl,actor}){
 if(!email(to))fail('A valid recipient email is required');if(!['test','invitation','reset'].includes(purpose))fail('Unsupported email purpose');
 const c=raw();if(!c.enabled||!c.password)fail('Configure and enable SMTP first');
 if(sending||(lastSend&&now()-lastSend<3000))fail('Please wait a few seconds before sending another email',429);
 if(purpose!=='test'){const u=new URL(setupUrl);if(u.origin!==origin||u.pathname!=='/reset-password.html'||!u.hash.startsWith('#token='))fail('Invalid account setup URL');}
 sending=true;lastSend=now();try{
 const addresses=await lookup(c.host);if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))fail('SMTP hostname must resolve to a public server');
 const factory=transportFactory||((await import('nodemailer')).default.createTransport);
 const transport=factory({host:addresses[0],port:c.port,secure:c.port===465,requireTLS:true,tls:{servername:c.host,minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:c.username,pass:c.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
 try{await transport.sendMail({from:{name:c.fromName,address:c.fromEmail},to,subject:purpose==='test'?'Salesdesk SMTP test':purpose==='invitation'?'Set up your Salesdesk account':'Reset your Salesdesk password',text:purpose==='test'?'Your Salesdesk CRM email connection is working.':`Use this private, one-use link to ${purpose==='invitation'?'set up your account':'reset your password'}:\n\n${setupUrl}\n\nThis link expires in 10 minutes. If you did not request this, ignore this email.`,disableFileAccess:true,disableUrlAccess:true});}finally{transport.close?.();}
 db.prepare('INSERT INTO smtp_delivery(actor,purpose,status,at) VALUES(?,?,?,?)').run(actor,purpose,'accepted',now());return {accepted:true};
 }catch(e){db.prepare('INSERT INTO smtp_delivery(actor,purpose,status,at) VALUES(?,?,?,?)').run(actor,purpose,'failed',now());if(e.status)throw e;fail('SMTP delivery failed. Check the SMTP host, mailbox password and sender address.',502);}finally{sending=false;}}
 return {settings,save,send};
}
