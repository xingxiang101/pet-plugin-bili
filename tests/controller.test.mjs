import test from 'node:test'
import assert from 'node:assert/strict'
import { createController, normalizeSettings, backgroundPrompt } from '../src/controller.mjs'
const meta={sdkCaller:{kind:'plugin',id:'bili',context:'panel'}}
const copy=value=>JSON.parse(JSON.stringify(value))
const until=async predicate=>{for(let i=0;i<600;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,5))}throw Error('timed out')}
async function fixture(options={}){
  const data=options.data||new Map(),secrets=new Map(),files=new Map(),jobs=new Map(),tools=new Map(),calls=[],prompts=[]
  let cfg=normalizeSettings(options.config||{}),authOptions,scope={scopeId:'scope-a',revision:1},starts=0
  if(options.logged!==false)secrets.set('bili.credentials.test',JSON.stringify({sessdata:'test-login-value-123456789',bili_jct:'a'.repeat(32),mid:'42',name:'pet-bili'}))
  const engine={dataDir:'/isolated',getConfig:async()=>cfg,setConfig:async value=>{cfg=copy(value)},readState:async p=>files.get(p),writeState:async(p,value)=>{files.set(p,copy(value))},accountChanged:()=>{calls.push(['accountChanged'])},dispose:()=>{calls.push(['dispose'])},cancel:id=>{calls.push(['cancel',id]);return true},start:async args=>{calls.push(args);const id='job-'+calls.length;jobs.set(id,{id,status:'completed',result:{text:'done',images:[],exitCode:0}});return id},get:id=>jobs.get(id),run:async args=>{calls.push(args);if(options.run)return options.run(args);return{text:args[0]==='dm-await'?JSON.stringify({hit:false}):args[0]==='inbox'?JSON.stringify({items:[]}):'done',images:[],exitCode:0}}}
  const pet={storage:{get:async(k,fallback)=>data.has(k)?copy(data.get(k)):fallback,set:async(k,v)=>{data.set(k,copy(v))}},secrets:{get:async k=>secrets.get(k),set:async(k,v)=>{secrets.set(k,v)},delete:async k=>secrets.delete(k)},profile:{getScope:async()=>({...scope})},ai:{start:async(prompt,opts)=>{starts++;prompts.push({prompt,opts});return{id:'ai-'+starts,status:'running'}},get:async()=>options.pendingAI?{status:'running'}:{status:'completed',text:'完成真实任务'},cancel:async id=>{calls.push(['ai.cancel',id]);options.pendingAI=false;return true}},tools:{register:spec=>tools.set(spec.name,{...spec,handler:(input,context={source:'host'})=>spec.handler(input,context)})},scheduler:{every:async()=> 'timer-1',cancel:async id=>{calls.push(['timer.cancel',id])}}}
  const controller=await createController({pet,engine,scopeKey:'test',scopeId:'scope-a',scopeRevision:1,now:options.now||Date.now,random:()=>0,verify:options.verify||(async()=>({mid:'42',name:'pet-bili'})),authFactory:opts=>{authOptions=opts;return{start:async()=>({id:'qr',status:'waiting',image:'data:image/png;base64,AA=='}),poll:async()=>({status:'waiting'}),cancel:()=>({status:'cancelled'}),dispose:()=>{}}}})
  controller.registerTools()
  return{controller,engine,pet,data,secrets,files,jobs,tools,calls,prompts,get starts(){return starts},setScope:value=>{scope=value},get auth(){return authOptions},get cfg(){return cfg}}
}
test('settings retain same-pet identity and bound schedule while rejecting invalid input',()=>{
  const value=normalizeSettings({persona:{name:'independent whale'},diary:{enabled:false},night:{maxVideos:999},listen:{commentIntervalSec:1}})
  assert.equal(value.persona,undefined);assert.equal(value.diary.enabled,true);assert.equal(value.night.maxVideos,10);assert.equal(value.listen.commentIntervalSec,60)
  assert.throws(()=>normalizeSettings({night:{windows:[{start:'25:00',end:'26:00'}]}}),/作息/)
})
test('panel methods reject legacy and other-plugin callers',async()=>{
  const f=await fixture();await assert.rejects(f.controller.api.state({}),/本插件/)
  await assert.rejects(f.controller.api.state({},{sdkCaller:{kind:'plugin',id:'other',context:'panel'}}),/本插件/)
  const state=await f.controller.api.state({},meta);assert.equal(state.account.mid,'42');assert.ok(!JSON.stringify(state).includes('test-login'))
  await f.controller.dispose()
})
test('context revision rejects stale callbacks even after switching back',async()=>{
  const f=await fixture();f.setScope({scopeId:'scope-a',revision:3})
  await assert.rejects(f.controller.api.wake({},meta),/身份已切换/)
  await assert.rejects(f.auth.save({sessdata:'test-login-value-123456789',bili_jct:'a'.repeat(32)}),/身份已切换/)
  assert.equal(f.starts,0);await f.controller.dispose()
})
test('background task uses scoped AI tools and host persona; completes with real result',async()=>{
  const f=await fixture();const task=await f.controller.api.wake({},meta)
  await until(async()=> (await f.controller.getState()).tasks.find(x=>x.id===task.id).status==='completed')
  assert.equal(f.starts,1);assert.deepEqual(f.prompts[0].opts.tools,['bili_command','bili_job','bili_journal'])
  assert.match(f.prompts[0].prompt,/沿用宿主当前角色/);assert.match(f.prompts[0].prompt,/不可信材料/)
  await f.controller.dispose()
})
test('normal empty inbox never spends AI tokens',async()=>{
  const f=await fixture({config:{enabled:true,owner:{mid:'9'},night:{windows:[]},listen:{dm:true}}})
  await f.controller.tick();assert.equal(f.starts,0);await f.controller.dispose()
})
test('owner DM receipt acknowledged only after completed AI and never replayed',async()=>{
  const f=await fixture({config:{enabled:true,owner:{mid:'9'},night:{windows:[]}},run:async args=>({text:args.includes('--ack')?'ok':JSON.stringify({hit:true,mid:'9',name:'owner',receipt:'receipt-1',text:'hello'}),exitCode:0})})
  await f.controller.tick();await until(()=>f.calls.some(x=>x[0]==='dm-await'&&x.includes('--ack')))
  assert.equal(f.starts,1);const again=f.controller.enqueue('dm','duplicate','receipt-1');assert.equal(again.status,'completed');assert.equal(f.starts,1)
  await f.controller.dispose()
})
test('failed or interrupted AI delivery retains receipt and does not acknowledge DM',async()=>{
  const f=await fixture({config:{enabled:true,owner:{mid:'9'},night:{windows:[]}},run:async()=>({text:JSON.stringify({hit:true,mid:'9',receipt:'receipt-2',text:'hello'}),exitCode:0})})
  f.pet.ai.get=async()=>({status:'failed',error:'uncertain'})
  await f.controller.tick();await until(async()=> (await f.controller.getState()).tasks[0]?.status==='failed')
  assert.ok(!f.calls.some(x=>x.includes('--ack')));f.controller.enqueue('dm','again','receipt-2');assert.equal(f.starts,1)
  await f.controller.dispose()
})
test('AI command cannot approve drafts, resume protection or publish stranger replies',async()=>{
  const f=await fixture();const handler=f.tools.get('bili_command').handler
  await assert.rejects(handler({args:['reply-draft','take','abc']}),/面板/)
  await assert.rejects(handler({args:['traffic','resume']}),/核查/)
  await assert.rejects(handler({args:['quota','allow','all']}),/已移除/)
  await f.controller.dispose()
})
test('journal tool writes two bounded plugin journals without arbitrary file access',async()=>{
  const f=await fixture(),handler=f.tools.get('bili_journal').handler
  await handler({action:'append',text:'看过的视频与想法'});await handler({action:'append',private:true,text:'偏好校准'})
  assert.match(f.files.get('.dsh/whale-diary.md'),/看过/);assert.match(f.files.get('.dsh/whale-diary-private.md'),/偏好/)
  await assert.rejects(handler({action:'write_file',text:'x'}),/不支持/)
  await f.controller.dispose()
})
test('QR save persists secret only in scope key and public state omits cookies',async()=>{
  const f=await fixture();await f.auth.save({sessdata:'new-login-value-123456789',bili_jct:'a'.repeat(32)})
  assert.match(f.secrets.get('bili.credentials.test'),/new-login/)
  const snapshot=await f.controller.api.state({},meta);assert.ok(!JSON.stringify(snapshot).includes('new-login'))
  assert.ok(!JSON.stringify([...f.files.values()]).includes('new-login'))
  await f.controller.dispose()
})
test('host scope and Bili account storage keys are both present',async()=>{
  const f=await fixture();assert.ok(f.data.has('controller.state.test.42'));assert.ok(!f.data.has('controller.state'))
  await f.controller.dispose()
})
test('disposing synchronously stops workers before awaiting scheduler or AI RPC',async()=>{
  const f=await fixture();await f.controller.start();const disposal=f.controller.dispose()
  assert.deepEqual(f.calls[0],['dispose']);await disposal;assert.ok(f.calls.some(x=>x[0]==='timer.cancel'))
})
test('public services bound payload size while AI tools can obtain actual image data',async()=>{
  const f=await fixture();const image='data:image/jpeg;base64,'+'A'.repeat(80000)
  f.jobs.set('image-job',{id:'image-job',status:'completed',result:{text:'中文'.repeat(20000),images:[image],exitCode:0}})
  const state=await f.controller.api.job({id:'image-job'},meta);assert.equal(state.result.images.length,0);assert.equal(state.result.imageCount,1)
  assert.ok(Buffer.byteLength(JSON.stringify(state))<65536)
  let actual='',offset=0;for(;;){const chunk=await f.controller.api.image({id:'image-job',index:0,offset},meta);actual+=chunk.chunk;if(chunk.next===null)break;offset=chunk.next}
  assert.equal(actual,image);const model=await f.tools.get('bili_job').handler({id:'image-job'});assert.equal(model.images[0],image)
  await f.controller.dispose()
})
test('restart marks unfinished tasks interrupted and never resubmits',async()=>{
  const data=new Map([['controller.state.test.42',{tasks:[{id:'previous',kind:'night',status:'running'}],receipts:{once:'previous'},logs:[],listeners:{}}]])
  const f=await fixture({data});assert.equal((await f.controller.getState()).tasks[0].status,'interrupted');assert.equal(f.starts,0)
  assert.equal(f.controller.enqueue('night','again','once').status,'interrupted');await f.controller.dispose()
})
test('review preflight failure retains draft and never publishes',async()=>{
  const f=await fixture({run:async()=>({text:'preflight failed',exitCode:2})})
  f.files.set('.bili-ai/pending-replies.json',{items:[{id:'deadbeef',oid:'1',root:'2',parent:'3',message:'reply'}]})
  const task=await f.controller.api.reviewDraft({id:'deadbeef',action:'approve'},meta)
  await until(async()=> (await f.controller.api.job({id:task.id},meta)).status==='failed')
  assert.ok(!f.calls.some(x=>x.includes('--go')));assert.equal(f.files.get('.bili-ai/pending-replies.json').items.length,1)
  await f.controller.dispose()
})
test('prompt retains two diaries, selected channel and stranger approval',()=>{
  const cfg=normalizeSettings({share:{via:'dm'},owner:{mid:'123'}});const prompt=backgroundPrompt('night',cfg)
  assert.match(prompt,/通道仅 dm/);assert.match(prompt,/两本日记/);assert.match(prompt,/等待主人在设置面板审核/)
})
test('long media job continues same business task into visual phase without polling away AI steps',async()=>{
  const f=await fixture(),image='data:image/jpeg;base64,QUFB'
  let idJob,first=true,ready=false
  f.engine.start=async args=>{idJob='long-media';f.jobs.set(idJob,{id:idJob,status:'running'});return idJob}
  f.pet.ai.get=async()=>{
    if(first){first=false;await f.tools.get('bili_command').handler({args:['watch-video','BV1fixture']},{source:'plugin-task',aiTaskId:'ai-'+f.starts});await assert.rejects(f.tools.get('bili_journal').handler({action:'append',text:'我已经看完了'},{source:'plugin-task',aiTaskId:'ai-'+f.starts}),/不得提前/);return{status:'completed',text:'视频正在处理，等待下一阶段。'}}
    assert.equal(ready,true);assert.equal(f.prompts.at(-1).opts.images[0],image);return{status:'completed',text:'已根据真实截图完成画面理解。'}
  }
  const task=await f.controller.api.wake({},meta)
  await until(()=>!!idJob);await new Promise(r=>setTimeout(r,30));assert.equal(f.starts,1)
  assert.equal((await f.controller.getState()).tasks[0].status,'running')
  assert.ok(!f.files.has('.dsh/whale-diary.md'))
  ready=true;f.jobs.set(idJob,{id:idJob,status:'completed',result:{text:'SHEET produced',images:[image],exitCode:0}})
  await until(async()=> (await f.controller.getState()).tasks.find(x=>x.id===task.id).status==='completed')
  assert.equal(f.starts,2);assert.equal((await f.controller.getState()).tasks[0].phase,2)
  assert.match(f.prompts[1].prompt,/之前已成功的发送、收藏或发布不可重复执行/)
  await f.controller.dispose()
})

test('unknown job id yields a useful error',async()=>{
  const f=await fixture();await assert.rejects(f.tools.get('bili_job').handler({id:'unknown'}),/作业已失效/);await f.controller.dispose()
})
test('settings mutations drain before logout selects another account',async()=>{
  const f=await fixture();let release,entered=false
  f.engine.setConfig=async value=>{if(!entered){entered=true;await new Promise(resolve=>{release=resolve})}}
  const saving=f.controller.api.saveSettings({...f.cfg,owner:{mid:'',name:'before-logout'}},meta)
  await until(()=>entered)
  const logout=f.controller.api.logout({},meta)
  await new Promise(resolve=>setTimeout(resolve,5));assert.ok(!f.calls.some(call=>call[0]==='accountChanged'))
  release();await saving;await logout
  assert.equal((await f.controller.getState()).account,null);await f.controller.dispose()
})
test('old business completion is persisted only to its original Bili account',async()=>{
  const f=await fixture({pendingAI:true});const task=f.controller.enqueue('night','fixture')
  await until(()=>f.starts===1)
  await f.controller.api.logout({},meta)
  await until(()=>f.data.get('controller.state.test.42')?.tasks.find(x=>x.id===task.id)?.status==='cancelled')
  const anonymous=f.data.get('controller.state.test.anonymous');assert.deepEqual(anonymous.tasks,[]);assert.deepEqual(anonymous.logs,[])
  await f.controller.dispose()
})
test('late draft preflight after logout cannot send or write new account receipts',async()=>{
  const f=await fixture();f.files.set('.bili-ai/pending-replies.json',{items:[{id:'abcdef12',oid:'1',root:'2',parent:'3',message:'reply'}]})
  let finishDry,dryStarted=false;f.engine.run=async args=>{f.calls.push(args);if(args.includes('--dry')){dryStarted=true;return new Promise(resolve=>{finishDry=resolve})}return{text:'done',exitCode:0}}
  const job=await f.controller.api.reviewDraft({id:'abcdef12',action:'approve'},meta);await until(()=>dryStarted)
  await f.controller.api.logout({},meta);finishDry({text:'dry ok',exitCode:0})
  await until(async()=> (await f.controller.api.job({id:job.id},meta)).status==='failed')
  assert.ok(!f.calls.some(args=>args.includes('--go')))
  assert.deepEqual(f.data.get('controller.state.test.anonymous').receipts,{})
  await f.controller.dispose()
})

test('paused night plan read cannot write or enqueue in the new account',async()=>{
  const f=await fixture({config:{enabled:true,night:{windows:[{start:'00:00',end:'24:00',wakes:1}],skipChance:0},listen:{dm:false}}})
  let release,reading=false;const oldRead=f.engine.readState;f.engine.readState=async file=>{if(file==='.dsh/whale-night.json'&&!reading){reading=true;return new Promise(resolve=>{release=resolve})}return oldRead(file)}
  const ticking=f.controller.tick();await until(()=>reading)
  await f.controller.api.logout({},meta);release({})
  await assert.rejects(ticking,/已变化/)
  assert.equal(f.files.has('.dsh/whale-night.json'),false);assert.equal(f.starts,0)
  assert.deepEqual(f.data.get('controller.state.test.anonymous').tasks,[]);await f.controller.dispose()
})

test('known compatibility settings and aliases survive normalization',()=>{
 const config=normalizeSettings({quota:{daily:7,shareDaily:4,scope:['uid:123','room:456']},aliases:['旧昵称'],night:{maxWakesPerDay:3}})
 assert.deepEqual(config.quota,{daily:7,shareDaily:4,scope:['uid:123','room:456']});assert.deepEqual(config.aliases,['旧昵称']);assert.equal(config.night.maxWakesPerDay,3)
})
test('dynamic edit text is written only to generated current-account import path',async()=>{
 const f=await fixture();const result=await f.controller.api.prepareText({text:'新的动态正文',path:'/outside.txt'},meta)
 assert.match(result.path,/^\/isolated\/\.dsh\/imports\/dynamic-edit-[a-f0-9-]+\.txt$/)
 assert.equal(f.files.get(result.path.replace('/isolated/','')),'新的动态正文')
 await assert.rejects(f.controller.api.prepareText({text:'x'.repeat(1001)},meta),/1000/)
 await assert.rejects(f.controller.api.prepareText({text:'x'}),/本插件/)
 await f.controller.dispose()
})
test('historical quota config is retained on next settings save',async()=>{
 const f=await fixture({config:{quota:{daily:8,scope:['uid:99'],shareDaily:2}}})
 const config=await f.controller.api.settings({},meta);assert.deepEqual(config.quota,{daily:8,scope:['uid:99'],shareDaily:2})
 await f.controller.api.saveSettings({...config,owner:{mid:'',name:'主人'}},meta);assert.deepEqual(f.cfg.quota,config.quota)
 await f.controller.dispose()
})
test('saving unrelated settings preserves comment inbox cursor and ids',async()=>{
 const data=new Map([['controller.state.test.42',{tasks:[],receipts:{},logs:[],listeners:{comment:{at:5,since:100,ids:['reply:1'],failures:1}}}]])
 const f=await fixture({data});await f.controller.api.saveSettings({...f.cfg,aliases:['曾用名']},meta)
 const listener=(await f.controller.getState()).listeners.comment;assert.equal(listener.since,100);assert.deepEqual(listener.ids,['reply:1']);assert.equal(listener.at,0)
 await f.controller.dispose()
})

test('manual cookie fallback validates and saves only through secrets without echoing',async()=>{
 const f=await fixture();const secret='manual-session-value-1234567890';const result=await f.controller.api.loginManual({cookie:'SESSDATA='+secret+'; bili_jct='+'a'.repeat(32)+'; buvid3=fixture'},meta)
 assert.equal(result.mid,'42');assert.ok(!JSON.stringify(result).includes(secret));assert.match(f.secrets.get('bili.credentials.test'),/manual-session/)
 assert.ok(!JSON.stringify([...f.data.values(),...f.files.values()]).includes(secret));await f.controller.dispose()
})
test('markdown notification template and configured search keywords reach actual workflow',async()=>{
 const f=await fixture({config:{notify:{template:'markdown'},preferences:{keywords:['围棋复盘']}}})
 assert.equal(f.cfg.notify.template,'markdown');f.controller.enqueue('night','fixture')
 await until(()=>f.starts===1);assert.ok(f.calls.some(args=>args[0]==='quota'&&args[1]==='react'&&args.includes('--auto')))
 assert.match(f.prompts[0].prompt,/围棋复盘/);assert.match(f.prompts[0].prompt,/真实执行的反馈同步/);await f.controller.dispose()
})
test('trusted tool source separates concurrent main chat from background ownership gates',async()=>{
 const f=await fixture({pendingAI:true});f.controller.enqueue('comment',JSON.stringify([{mid:'88',exact:true,oid:'1',root:'2',parent:'3'}]));await until(()=>f.starts===1)
 const command=f.tools.get('bili_command').handler,bg={source:'plugin-task',aiTaskId:'ai-1'}
 await assert.rejects(command({args:['comment','--oid=1','--root=2','--parent=3','--go=true']},bg),/审核/)
 await assert.rejects(command({args:['comment','--oid','1','--go']},{source:'host'}),/当前对话/)
 await assert.rejects(command({args:['help']},{source:'plugin-task',aiTaskId:'forged'}),/已失效/)
 const result=await command({args:['comment','--oid','1','--root','2','--parent','3','--go'],request:'主人明确请回复这一条'},{source:'chat'})
 const id=JSON.parse(result.text).id;assert.ok(id)
 await assert.rejects(f.tools.get('bili_job').handler({id},bg),/不属于/)
 await f.controller.dispose()
})
test('traffic resolution remains an explicit panel audit action',async()=>{
 const f=await fixture();await assert.rejects(f.tools.get('bili_command').handler({args:['traffic','resolve','--id','test','--outcome','not-sent','--go']},{source:'chat'}),/核查/);await f.controller.dispose()
})
test('manual long video command really resumes with images and returns through current pet',async()=>{
 const f=await fixture(),image='data:image/png;base64,QUFB',spoken=[];f.pet.pet={speak:async text=>spoken.push(text)}
 f.engine.start=async()=>{const id='manual-video';f.jobs.set(id,{id,status:'running'});return id}
 const result=await f.tools.get('bili_command').handler({args:['watch-video','BV1fixture'],request:'看这个视频并告诉我画面讲了什么'},{source:'chat'});const id=JSON.parse(result.text).id
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.starts,0)
 f.jobs.set(id,{id,status:'completed',result:{text:'真实媒体结果',images:[image],exitCode:0}})
 await until(()=>f.starts===1);assert.equal(f.prompts[0].opts.images[0],image);assert.match(f.prompts[0].prompt,/看这个视频并告诉我画面/)
 await until(()=>spoken.length===1);assert.equal((await f.controller.getState()).tasks[0].status,'completed');await f.controller.dispose()
})
test('manual tool result already returned to chat is not analyzed twice',async()=>{
 const f=await fixture();const result=await f.tools.get('bili_command').handler({args:['video','BV1fixture']},{source:'chat'});const id=JSON.parse(result.text).id
 await f.tools.get('bili_job').handler({id},{source:'chat'})
 await until(async()=>(await f.controller.getState()).tasks[0]?.status==='completed');assert.equal(f.starts,0);await f.controller.dispose()
})
test('comment backlog advances only the resolved batch, including same-second ids',async()=>{
 let time=200000;const items=Array.from({length:25},(_,i)=>({kind:'reply',id:String(i+1),t:101,mid:'8',oid:'1',root:'2',parent:String(i+10),business:'1'}))
 const data=new Map([['controller.state.test.42',{tasks:[],receipts:{},logs:[],listeners:{comment:{at:0,since:100,ids:[],failures:0}}}]])
 const f=await fixture({data,now:()=>time,config:{enabled:true,night:{windows:[]},listen:{comment:true,allDay:true,dm:false}},run:async args=>({text:JSON.stringify(args[0]==='inbox'?{items}:args[0]==='reply-context'?{items:JSON.parse(args[1]).map(item=>({...item,exact:false}))}:{items:[]}),exitCode:0})})
 await f.controller.tick();assert.equal((await f.controller.getState()).listeners.comment.ids.length,20)
 time+=60001;await f.controller.tick();assert.equal((await f.controller.getState()).listeners.comment.ids.length,25)
 assert.deepEqual(f.calls.filter(args=>args[0]==='reply-context').map(args=>JSON.parse(args[1]).length),[20,5]);await f.controller.dispose()
})
test('owner-only live ignores stranger mentions using structured uid event',async()=>{
 const f=await fixture({config:{enabled:true,owner:{mid:'9'},night:{windows:[]},listen:{dm:false,live:true,liveRoom:'123',liveScope:'owner'}}});let index=0,lastId
 f.engine.start=async args=>{f.calls.push(args);lastId='live-'+(++index);f.jobs.set(lastId,{id:lastId,status:'completed',result:{text:'AWAIT_EVENT '+JSON.stringify({uid:'8',uname:'stranger',dmid:'d1',via:'@了我',text:'hi'}),images:[],exitCode:0}});return lastId}
 await f.controller.tick();await f.controller.tick();assert.equal(f.starts,0);assert.ok(f.calls.some(args=>args.includes('--scope')&&args.includes('owner')))
 f.jobs.set(lastId,{id:lastId,status:'completed',result:{text:'AWAIT_EVENT '+JSON.stringify({uid:'9',uname:'owner',dmid:'d2',via:'operator',text:'hello'}),images:[],exitCode:0}})
 await f.controller.tick();await until(()=>f.starts===1);assert.match(f.prompts[0].prompt,/hello/);await f.controller.dispose()
})

test('dynamic reply draft preserves type and referer through publish and readback',async()=>{
 const f=await fixture();f.files.set('.bili-ai/pending-replies.json',{items:[{id:'abcdef12',oid:'123',root:'22',parent:'33',business:'17',type:'17',referer:'https://www.bilibili.com/opus/123',message:'草稿正文'}]})
 f.engine.run=async args=>{f.calls.push(args);if(args.includes('--go'))return{text:'已发布，评论 rpid=999',exitCode:0};if(args[0]==='thread')return{text:'rpid=999',exitCode:0};return{text:'ok',exitCode:0}}
 const task=await f.controller.api.reviewDraft({id:'abcdef12',action:'approve'},meta)
 await until(async()=>(await f.controller.api.job({id:task.id},meta)).status==='completed')
 for(const args of f.calls.filter(args=>args[0]==='comment'||args[0]==='thread')){assert.equal(args[args.indexOf('--type')+1],'17');assert.equal(args[args.indexOf('--referer')+1],'https://www.bilibili.com/opus/123')}
 assert.ok(f.calls.some(args=>args[0]==='reply-draft'&&args[1]==='drop'));await f.controller.dispose()
})
test('canceling manual continuation stops its media and never starts AI',async()=>{
 const f=await fixture();f.engine.start=async()=>{const id='cancel-media';f.jobs.set(id,{id,status:'running'});return id}
 await f.tools.get('bili_command').handler({args:['watch-video','BV1fixture']},{source:'chat'})
 const task=(await f.controller.getState()).tasks[0];await f.controller.api.cancelTask({id:task.id},meta)
 await until(async()=>(await f.controller.getState()).tasks[0].status==='cancelled')
 assert.ok(f.calls.some(args=>args[0]==='cancel'&&args[1]==='cancel-media'));assert.equal(f.starts,0);await f.controller.dispose()
})
test('draft pagination bounds service payload and preserves access to remaining items',async()=>{
 const f=await fixture();f.files.set('.bili-ai/pending-replies.json',{items:Array.from({length:25},(_,index)=>({id:index.toString(16).padStart(8,'0'),oid:'1',root:'2',parent:'3',who:'名'.repeat(100),src:'原'.repeat(300),message:'回'.repeat(500),referer:'https://www.bilibili.com/opus/123',extra:'x'.repeat(10000)}))})
 const page=await f.controller.api.drafts({},meta);assert.equal(page.items.length,10);assert.equal(page.next,10);assert.ok(Buffer.byteLength(JSON.stringify(page))<65536)
 assert.equal((await f.controller.api.drafts({offset:20},meta)).items.length,5);assert.equal((await f.controller.api.drafts({offset:20},meta)).next,null);await f.controller.dispose()
})
test('legacy night tool does not execute old clock or consume controlled schedule',async()=>{
 const f=await fixture();const result=await f.tools.get('bili_command').handler({args:['night','mark']},{source:'chat'})
 assert.equal(JSON.parse(result.text).managed,true);assert.ok(!f.calls.some(args=>args[0]==='night'));await f.controller.dispose()
})

test('cancel after media completes during grace interval never starts continuation AI',async()=>{
 const f=await fixture(),spoken=[];f.pet.pet={speak:async text=>spoken.push(text)}
 const result=await f.tools.get('bili_command').handler({args:['video','BV1fixture']},{source:'chat'});const id=JSON.parse(result.text).id
 await until(async()=>(await f.controller.getState()).tasks[0]?.status==='running');await f.controller.api.cancelJob({id},meta)
 await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(f.starts,0);assert.deepEqual(spoken,[]);assert.equal((await f.controller.getState()).tasks[0].status,'cancelled');await f.controller.dispose()
})
test('unknown host tools cannot trigger notification side effects without go flag',async()=>{
 const f=await fixture();await assert.rejects(f.tools.get('bili_command').handler({args:['notify','content']},{source:'host'}),/当前对话/);await f.controller.dispose()
})
