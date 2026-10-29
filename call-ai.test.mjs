import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCallAI, transcribe, summarize, listModels, sarvamBatch, combinedAudio } from './call-ai.mjs';
const json=value=>new Response(JSON.stringify(value),{status:200});
test('vault reuses provider keys, never exposes secrets and prevents wrong-provider or in-use disable',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'call-ai-vault-')),db=new DatabaseSync(':memory:');let header;
  const api=createCallAI({db,keyPath:join(dir,'key'),all:()=>[],get:()=>null,playback:()=>null,fetcher:async(url,init)=>{header=init.headers.Authorization;return json({data:[{id:'gpt-audio-mini'}]});}});
  try{
    const key=api.saveKey({label:'Company OpenAI',provider:'openai',key:'secret-one'});
    assert.equal(key.key,undefined);assert.doesNotMatch(JSON.stringify(api.vaultList()),/secret-one/);
    const settings=api.save({enabled:true,acknowledged:true,iqEnabled:true,stt:{provider:'openai',model:'gpt-transcribe',keyId:key.id},iq:{provider:'openai',model:'text-model',keyId:key.id}});
    assert.equal(settings.stt.keyId,settings.iq.keyId);assert.equal(api.vaultList().length,1);
    assert.throws(()=>api.saveKey({...key,active:false}),/different key/);
    await api.models({part:'stt',provider:'openai-audio',keyId:key.id});assert.equal(header,'Bearer secret-one');
    api.saveKey({...key,key:'secret-two'});
    await api.models({part:'stt',provider:'openai-audio',keyId:key.id});assert.equal(header,'Bearer secret-two');
    await assert.rejects(api.models({part:'stt',provider:'google',keyId:key.id}),/active saved key/);
    assert.equal(Buffer.from(db.prepare('SELECT body FROM api_key_vault').get().body).includes(Buffer.from('secret-two')),false);
  }finally{api.close();db.close();rmSync(dir,{recursive:true});}
});
test('combined audio uses one audio request and validates both outputs',async()=>{
  let count=0,converted=0;
  const result=await combinedAudio({model:'gpt-audio',key:'test'},{bytes:Buffer.from('m4a'),mime:'audio/mp4'},async(url,init)=>{
    count++;const body=JSON.parse(init.body);assert.equal(body.store,false);assert.deepEqual(body.modalities,['text']);assert.equal(body.messages[1].content[1].input_audio.format,'mp3');
    return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({transcript:'வணக்கம்',summary:'Customer requested pricing.'})}}]});
  },async()=>{converted++;return {bytes:Buffer.from('converted'),mime:'audio/mpeg'};});
  assert.equal(result.transcript,'வணக்கம்');assert.equal(count,1);assert.equal(converted,1);
  await assert.rejects(combinedAudio({model:'gpt-audio',key:'test'},{bytes:Buffer.from('wav'),mime:'audio/wav'},async()=>json({choices:[{finish_reason:'length'}]})),/truncated/);
  await assert.rejects(combinedAudio({model:'gpt-audio',key:'test'},{bytes:Buffer.from('wav'),mime:'audio/wav'},async()=>json({choices:[{message:{content:'not JSON'}}]})),/invalid/);
});
test('combined worker does not invoke a second IQ provider',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'call-ai-combined-')),db=new DatabaseSync(':memory:');let count=0;
  const call={id:'c',leadId:'l',recordingId:'r'},lead={id:'l',owner:'u'};
  const api=createCallAI({db,keyPath:join(dir,'key'),all:kind=>kind==='mobileCalls'?[call]:[],get:()=>lead,playback:()=>({bytes:Buffer.from('audio'),mime:'audio/wav'}),fetcher:async url=>{count++;assert.equal(url,'https://api.openai.com/v1/chat/completions');return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({transcript:'Call text',summary:'Call insight'})}}]});}});
  try {
    const settings=api.save({enabled:true,acknowledged:true,iqEnabled:true,stt:{provider:'openai-audio',model:'gpt-audio',key:'test'},iq:{provider:'claude',model:''}});
    assert.equal(settings.iqEnabled,false);const user={user:{id:'u',role:'member'}};api.enqueue('r',user);await api.tick();
    assert.equal(api.result('r',user).mode,'combined');assert.equal(api.result('r',user).summary,'Call insight');assert.equal(count,1);
  }finally{api.close();db.close();rmSync(dir,{recursive:true});}
});
test('Sarvam batch persists upload/start stages and polls the same job before downloading exact outputs',async()=>{
  let batch,creates=0,starts=0,uploads=0,statusChecks=0;
  const fetcher=async(url,init)=>{
    if(url.endsWith('/job/v1')){creates++;assert.equal(JSON.parse(init.body).job_parameters.model,'saaras:v4');return json({job_id:'job_test'});}
    if(url.endsWith('/upload-files'))return json({upload_urls:{'call.m4a':{file_url:'https://test.blob.core.windows.net/call?sig=secret'}}});
    if(init.method==='PUT'){uploads++;assert.equal(init.headers['x-ms-blob-type'],'BlockBlob');assert.equal(init.headers['api-subscription-key'],undefined);return new Response('',{status:201});}
    if(url.endsWith('/start')){starts++;return json({job_state:'Running'});}
    if(url.endsWith('/status')){statusChecks++;return json(statusChecks===1?{job_state:'Running'}:{job_state:'Completed',job_details:[{state:'Success',outputs:[{file_name:'0.json'}]}]});}
    if(url.endsWith('/download-files')){assert.deepEqual(JSON.parse(init.body).files,['0.json']);return json({download_urls:{'0.json':{file_url:'https://test.blob.core.windows.net/result?sig=secret'}}});}
    return json({transcript:'Long call transcript'});
  };
  const args=[{provider:'sarvam',key:'key',model:'saaras:v4'},{bytes:Buffer.from('audio'),mime:'audio/mp4'}];
  const checkpoint=value=>{batch=value;};
  const first=await sarvamBatch(...args,undefined,checkpoint,fetcher);assert.equal(first.pending,true);
  const result=await sarvamBatch(...args,batch,checkpoint,fetcher);assert.equal(result.transcript,'Long call transcript');
  assert.equal(creates,1);assert.equal(uploads,1);assert.equal(starts,1);
});
test('Sarvam rejects an unexpected presigned storage destination',async()=>{
  const fetcher=async url=>json(url.endsWith('/job/v1')?{job_id:'job_safe'}:{upload_urls:{'call.m4a':{file_url:'http://127.0.0.1/private'}}});
  await assert.rejects(sarvamBatch({model:'saaras:v4',key:'key'},{bytes:Buffer.from('audio'),mime:'audio/mp4'},null,()=>{},fetcher),/storage host/);
});
test('provider-specific catalogs exclude incompatible models and require credentials',async()=>{
  await assert.rejects(listModels({part:'iq',provider:'openai'}),/API key/);
  assert.deepEqual((await listModels({part:'stt',provider:'sarvam'})).models,['saaras:v4','saaras:v3']);
  const fetcher=async()=>json({data:[{id:'gpt-transcribe'},{id:'gpt-4.1-mini'},{id:'tts-1'},{id:'gpt-image-1'}]});
  assert.deepEqual((await listModels({part:'stt',provider:'openai',key:'test'},fetcher)).models,['gpt-transcribe']);
  assert.deepEqual((await listModels({part:'iq',provider:'openai',key:'test'},fetcher)).models,['gpt-4.1-mini']);
  assert.deepEqual((await listModels({part:'iq',provider:'ollama'},async()=>json({models:[{name:'local:latest'}]}))).models,['local:latest']);
  await assert.rejects(listModels({part:'stt',provider:'claude',key:'test'}),/Unsupported/);
});
test('all speech adapters send the documented fields and parse transcripts',async()=>{
  for(const provider of ['openai','google','elevenlabs']){
    let called=false;
    const result=await transcribe({provider,key:'private-key',model:'test-model'},{bytes:Buffer.from('audio'),mime:'audio/mp4'},async(url,init)=>{
      called=true;
      assert.equal(init.redirect,'error');
      if(provider==='google')assert.equal(JSON.parse(init.body).contents[0].parts[1].inlineData.mimeType,'audio/mp4');
      else {assert.equal(init.body.get('file').name,'call.m4a');assert.equal(init.body.get(provider==='elevenlabs'?'model_id':'model'),'test-model');}
      return json(provider==='google'?{candidates:[{content:{parts:[{text:'வணக்கம்'}]}}]}:provider==='sarvam'?{transcript:'வணக்கம்'}:{text:'வணக்கம்'});
    });
    assert.equal(result,'வணக்கம்');assert.equal(called,true);
  }
});
test('all IQ adapters extract content without treating transcript as system instructions',async()=>{
  for(const provider of ['openai','claude','ollama','grok'])assert.equal(await summarize({provider,key:'secret',model:'test'},'customer transcript',async(url,init)=>{
    const body=JSON.parse(init.body);assert.equal(body.messages.at(-1).content,'customer transcript');
    return json(provider==='claude'?{content:[{type:'text',text:'summary'}]}:provider==='ollama'?{message:{content:'summary'}}:{choices:[{message:{content:'summary'}}]});
  }),'summary');
});
test('encrypted settings, scoped result access, idempotent queue and IQ retry preserve transcription',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'call-ai-test-')),db=new DatabaseSync(':memory:');let speechRequests=0,summaryRequests=0;
  const lead={id:'l',owner:'u'},call={id:'c',leadId:'l',recordingId:'r',duration:47,createdAt:new Date().toISOString()};
  const api=createCallAI({db,keyPath:join(dir,'key'),all:kind=>kind==='mobileCalls'?[call]:[],get:()=>lead,playback:()=>({bytes:Buffer.from('audio'),mime:'audio/mp4'}),fetcher:async url=>{
    if(url.includes('transcriptions')){speechRequests++;return json({text:'Customer requested pricing.'});}
    summaryRequests++;return summaryRequests===1?new Response('{}',{status:429}):json({choices:[{message:{content:'Send quotation.'}}]});
  }});
  const config={enabled:true,automatic:false,acknowledged:true,iqEnabled:true,stt:{provider:'openai',model:'test',key:'STT-SECRET'},iq:{provider:'openai',model:'test',key:'IQ-SECRET'}};
  try{
    assert.throws(()=>api.save({...config,acknowledged:false}),/Acknowledge/);
    const saved=api.save(config);assert.equal(saved.stt.key,undefined);assert.equal(saved.stt.hasKey,true);
    assert.equal(Buffer.from(db.prepare('SELECT body FROM call_ai_settings').get().body).includes(Buffer.from('STT-SECRET')),false);
    assert.throws(()=>api.result('r',{user:{id:'other',role:'member'}}),/accessible/);
    const user={user:{id:'u',role:'member'}};
    api.enqueue('r',user);api.enqueue('r',user);await api.tick();assert.equal(api.result('r',user).status,'error');assert.equal(api.result('r',user).transcript,'Customer requested pricing.');
    api.enqueue('r',user);await api.tick();assert.equal(api.result('r',user).summary,'Send quotation.');assert.equal(speechRequests,1);assert.equal(summaryRequests,2);
    api.enqueue('r',user);await api.tick();assert.equal(summaryRequests,2);
  }finally{api.close();db.close();rmSync(dir,{recursive:true});}
});
