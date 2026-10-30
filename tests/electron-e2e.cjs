'use strict';
// Real application + real plugin utilityProcess + sandboxed plugin panel.
// Account/SMS uses a bounded loopback fixture. No Bilibili login or writes occur.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const HOST=path.resolve(process.env.PET_PLUGIN_HOST_DIR||'');
if(!process.env.PET_PLUGIN_HOST_DIR)throw Error('Set PET_PLUGIN_HOST_DIR to the actual desktop-pet/demo checkout.');
const H=require(path.join(HOST,'../tests/e2e-helpers'));
const {activateButton,activateClosingButton}=require(path.join(HOST,'../tests/e2e/html-card-input'));
const ROOT=path.resolve(__dirname,'..'),ZIP=path.resolve(process.env.PET_BILI_PLUGIN_ZIP||path.join(ROOT,'dist','bili-0.1.0.zip')),CDP=Number(process.env.PET_BILI_E2E_CDP_PORT)||9488;
const repro=process.argv.includes('--repro-chat-entry');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-pet-bili-'));
const artifact=path.join(ROOT,'artifacts',repro?'chat-entry-repro':'electron-e2e');fs.mkdirSync(artifact,{recursive:true});
// The candidate may be a downloaded CI/Release ZIP. Derive the registry contract
// from those exact bytes, never from the potentially different source checkout.
const zipBytes=fs.readFileSync(ZIP),{readEntries,readEntryData}=require(path.join(HOST,'core/plugin-runtime/zip'));
const manifestEntries=readEntries(zipBytes).filter(entry=>entry.name==='manifest.json');
assert.equal(manifestEntries.length,1,'the release ZIP must contain exactly one root manifest');
const manifest=JSON.parse(readEntryData(zipBytes,manifestEntries[0]).toString('utf8'));
assert.equal(manifest.id,'bili');assert.ok(Array.isArray(manifest.permissions));assert.ok(Array.isArray(manifest.services));assert.ok(Array.isArray(manifest.platforms));
const permissions=[...new Set([...manifest.permissions,...manifest.services.map(name=>'service:'+name)])];
const packagePath='/releases/bili-'+encodeURIComponent(manifest.version)+'.zip';
const WATCH='BV1234567890',BARE='BV4234567890',CANCEL_MEDIA='BV2234567890',CANCEL_AI='BV3234567890';
const NIGHT_REPLY='定时浏览测试：生态关系值得继续观察。https://www.bilibili.com/video/'+WATCH+'/ SCHEDULED_SHARE_END';
let nightRequests=0;
const QUESTION='WATCH_MAIN：画面是什么样的？请明确区分抽帧观察与声音。';
const REPLY='我看到了视频抽帧中的彩色测试图。这里只能确认画面采样，没有音轨或字幕依据。\n'+('这次观察来自实际下载的视频截图，彩色方格与变化的图案清晰可见。'.repeat(35))+'\nWATCH_REPLY_COMPLETE_END';
const CHAT_MAIN='帮我看看 https://www.bilibili.com/video/'+WATCH+'/ 。'+QUESTION;
const BARE_LINK='https://www.bilibili.com/video/'+BARE+'/';
const BARE_REPLY='我看完了你发来的彩色测试视频，截图里能看到测试图案。BARE_VIDEO_REPLY_END';
const networkAudit=path.join(profile,'watch-network.jsonl'),modelRequests=[],chatRequests=[],biliRequests=[],mediaRequests=[],submittedMessages=[];
const registryRequests=[],packageDownloads=[];
const chatTasks=new Map();let currentTaskId,missingWatchTool=false;
const parseTool=value=>{for(let i=0;i<5;i++){if(typeof value==='string'){try{value=JSON.parse(value);continue;}catch{return null;}}if(value&&typeof value==='object'){if(value.taskId)return value;if(value.text){value=value.text;continue;}if(value.content){value=value.content;continue;}}return null;}return null;};
let pendingMain,mediaCancelled=false,aiCancelled=false;
let child,server,chat;const report={profile,host:HOST,zip:ZIP,sha256:crypto.createHash('sha256').update(zipBytes).digest('hex'),marketFixture:{kind:'isolated-local-registry',officialPublicationVerified:false},checks:[]};
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);};
const wait=async(check,label)=>{for(let i=0;i<400;i++){const value=await check();if(value)return value;await H.sleep(100);}throw Error('Timeout: '+label);};
(async()=>{
try{
  const target=path.join(profile,'plugins','bili');
  const video=path.join(profile,'fixture-source.mp4');
  const generator=path.join(ROOT,'node_modules','ffmpeg-static',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
  execFileSync(generator,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=640x360:rate=4','-t','4','-pix_fmt','yuv420p',video],{timeout:30000});
  const sourceVideo=fs.readFileSync(video);
  const finishModel=(res,text)=>{if(!res.headersSent)res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}})+'\n\n');res.end('data: [DONE]\n\n');};
  fs.writeFileSync(path.join(artifact,'native.jsonl'),'');
  server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/registry/plugins.json'){
      registryRequests.push(url.pathname);res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({schemaVersion:1,plugins:[{id:manifest.id,name:manifest.name,description:manifest.description,author:'Local E2E fixture',repo:'https://github.com/xingxiang101/pet-plugin-bili',version:manifest.version,apiVersion:manifest.apiVersion,minHostVersion:manifest.minHostVersion,permissions,services:manifest.services,platforms:manifest.platforms,nodeAccess:true,sha256:report.sha256,download:'http://127.0.0.1:'+server.address().port+packagePath}]}));
    }
    if(url.pathname==='/registry/blocklist.json'){
      registryRequests.push(url.pathname);res.setHeader('content-type','application/json');return res.end(JSON.stringify({schemaVersion:1,blocked:[]}));
    }
    if(url.pathname===packagePath){
      packageDownloads.push({path:url.pathname,bytes:zipBytes.length,sha256:report.sha256});
      res.setHeader('content-type','application/zip');res.setHeader('content-length',zipBytes.length);return res.end(zipBytes);
    }
    if(url.pathname==='/v1/chat/completions'){
      const body=JSON.parse(raw),prompt=JSON.stringify(body.messages),images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(part=>part.type==='image_url').map(part=>part.image_url.url);
      const toolNames=(body.tools||[]).map(tool=>tool.function?.name);
      if(prompt.includes('按作息自主浏览')){nightRequests++;return finishModel(res,NIGHT_REPLY);}
      if(!images.length){
        const lastUser=body.messages.findLastIndex(message=>message.role==='user'),turn=body.messages.slice(lastUser+1),text=JSON.stringify(body.messages[lastUser]?.content||'');
        const result=turn.filter(message=>message.role==='tool').at(-1);
        chatRequests.push({user:text,tools:toolNames,hasToolResult:!!result});
        if(text.includes('我去倒杯水'))return finishModel(res,'好，等你回来我再跟你聊。ORDINARY_CHAT_DURING_WATCH');
        if(result){const value=parseTool(result.content);if(value?.taskId){currentTaskId=value.taskId;chatTasks.set(text,value);}return finishModel(res,/^"取消/.test(text)?'已经取消这次观看。':'我去看看，完成后会回来告诉你。');}
        const cancel=/^"取消/.test(text),watchTool=toolNames.find(name=>name.endsWith('bili_watch_video')),cancelTool=toolNames.find(name=>name.endsWith('bili_watch_task'));
        if((cancel&&!cancelTool)||(!cancel&&!watchTool)){missingWatchTool=true;return finishModel(res,'当前聊天没有专用的视频观看工具入口。CHAT_WATCH_TOOL_MISSING');}
        const target=text.includes(CANCEL_MEDIA)?CANCEL_MEDIA:text.includes(CANCEL_AI)?CANCEL_AI:text.includes(BARE)?BARE:WATCH;
        const args=cancel?{id:currentTaskId,cancel:true}:{target,question:text.includes(QUESTION)?QUESTION:text.includes('WATCH_CANCEL_AI')?'WATCH_CANCEL_AI：取消模型分析阶段':text.includes('WATCH_CANCEL_MEDIA')?'WATCH_CANCEL_MEDIA：取消下载阶段':''};
        res.writeHead(200,{'content-type':'text/event-stream'});
        res.write('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:crypto.randomUUID(),type:'function',function:{name:cancel?cancelTool:watchTool,arguments:JSON.stringify(args)}}]},finish_reason:null}]})+'\n\n');
        res.write('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n');return res.end('data: [DONE]\n\n');
      }
      modelRequests.push({question:prompt.includes('WATCH_CANCEL_AI')?'cancel-ai':prompt.includes(BARE)?'bare':'main',tools:toolNames,imageCount:images.length,images:images.map(image=>{const bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64');return{sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,jpeg:bytes[0]===0xff&&bytes[1]===0xd8};}),hasQuestion:prompt.includes(QUESTION),hasVideo:prompt.includes('本地四秒彩色测试图')});
      res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting for fixture completion\n\n');
      if(prompt.includes('WATCH_CANCEL_AI')){res.on('close',()=>{if(!res.writableEnded)aiCancelled=true;});return;}
      pendingMain=()=>finishModel(res,prompt.includes(BARE)?BARE_REPLY:REPLY);return;
    }
    if(url.pathname.startsWith('/media/')){
      const bvid=path.basename(url.pathname,'.mp4');mediaRequests.push(bvid);
      res.setHeader('content-type','video/mp4');
      if(bvid===CANCEL_MEDIA){res.on('close',()=>{if(!res.writableEnded)mediaCancelled=true;});res.writeHead(200);res.write(sourceVideo.subarray(0,32));return;}
      res.setHeader('content-length',sourceVideo.length);res.end(sourceVideo);return;
    }
    res.setHeader('content-type','application/json');
    if(url.pathname.startsWith('/bili/')){
      biliRequests.push({path:url.pathname,method:req.method,bvid:url.searchParams.get('bvid')});
      if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({code:-400,message:'test forbids Bili writes'}));}
      if(url.pathname.endsWith('/nav'))return res.end(JSON.stringify({code:0,data:{isLogin:true,mid:111,uname:'本地测试账号',wbi_img:{img_url:'https://i.example/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i.example/4932caff0ff746eab6f01bf08b70ac45.png'}}}));
      if(url.pathname.endsWith('/view'))return res.end(JSON.stringify({code:0,data:{aid:12,cid:34,title:'本地四秒彩色测试图',duration:4,owner:{name:'本地素材夹具'}}}));
      if(url.pathname.endsWith('/playurl'))return res.end(JSON.stringify({code:0,data:{quality:64,durl:[{url:'https://upos-sz-mirrorcos.bilivideo.com/media/'+url.searchParams.get('bvid')+'.mp4'}]}}));
      res.statusCode=404;return res.end(JSON.stringify({code:-404,message:'unexpected test read'}));
    }
    if(req.url.includes('/api/activation/'))return res.end(JSON.stringify(req.url.includes('/phone/verify')?{phoneProof:'bili-fixture',expiresIn:600}:{environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'}}));
    if(req.url.startsWith('/api/'))return res.end(JSON.stringify({environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'},uid:101,nickname:'fixture',character:'qiqi'}));
    res.end(JSON.stringify({schemaVersion:1,plugins:[],blocked:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({onboarding:{completed:true},character:'qiqi',petName:'插件测试宠物',tts:{enabled:false},general:{autoCheckUpdates:false},behavior:{walk:false,sleep:false},relay:{url:''},ai:{source:'manual',provider:'openai-compatible',baseUrl:base+'/v1',apiKey:'fixture-local-key',model:'watch-fixture'},plugins:{registrySources:[base+'/registry'],grants:{bili:{granted:permissions,version:manifest.version,at:Date.now()}}}}));
  fs.writeFileSync(profile+'.environment-selection.json',JSON.stringify({environment:'test'}));
  async function boot(install=false){
    child=H.launch({userData:profile,cdpPort:CDP,bootstrap:path.join(HOST,'../tests/helpers/appearance-hidden-bootstrap.js'),env:{PET_E2E_TEST:'1',PET_E2E_USE_MOCK_KEYCHAIN:'1',PET_PUBLIC_NATIVE_LOG:path.join(artifact,'native.jsonl'),PET_BILI_E2E_FIXTURE_BASE:base,PET_BILI_E2E_NETWORK_AUDIT:networkAudit,NODE_OPTIONS:'--require='+JSON.stringify(path.join(ROOT,'tests/helpers/watch-network-fixture.cjs')),PET_E2E_ENV_CONFIG:JSON.stringify({test:{accountApiBase:base+'/api',analyticsEvents:'',agentTrace:'',diagnostics:''}})}});
    await wait(async()=>{try{return(await fetch('http://127.0.0.1:'+CDP+'/json').then(r=>r.json())).length>0;}catch{return false;}},'CDP');
    await H.sleep(1200);
    const pages=await fetch('http://127.0.0.1:'+CDP+'/json').then(r=>r.json());
    if(pages.some(p=>p.url.includes('trial-entry.html'))){const login=await H.findReadyTarget(CDP,'trial-entry.html','trialAccess');await H.evalIn(login,"document.querySelector('#phone').focus()");await H.cdp(login,'Input.insertText',{text:'19977776661'});await H.evalIn(login,"document.querySelector('#sms').focus()");await H.cdp(login,'Input.insertText',{text:'123456'});await activateButton(login,'.primary',{capture:false});check(await H.waitTargetGone(CDP,'trial-entry.html'),'host login uses real input');}
    const pet=await H.findTarget(CDP,'/index.html');await wait(()=>H.evalIn(pet,'!!window.petAPI'),'pet API');
    await H.evalIn(pet,'window.petAPI.openSettings("plugins")');const settings=await H.findReadyTarget(CDP,'settings.html','settings');
    if(install){
      const index=await H.evalIn(settings,'settings.pluginsRegistryList({refresh:true})'),entry=index.plugins?.find(item=>item.id==='bili');
      check(index.fetched&&index.sources.length===1&&index.sources[0]===base+'/registry'&&!!entry,'real host RegistryClient loads the isolated local market fixture');
      assert.deepEqual(entry.permissions,permissions);assert.deepEqual(entry.platforms,manifest.platforms);
      check(entry.version===manifest.version&&entry.sha256===report.sha256&&entry.nodeAccess===true&&entry.download===base+packagePath,'market entry preserves actual ZIP version, SHA256, permissions, services, platforms and Node access');
      report.marketFixture.entry=entry;
      const installed=await H.evalIn(settings,"settings.pluginsInstallMarket('bili')");
      check(installed.ok,'release ZIP installs from the local market through the host SHA256 and permissions pipeline: '+JSON.stringify(installed));
      check(registryRequests.includes('/registry/plugins.json')&&packageDownloads.length===1&&packageDownloads[0].sha256===report.sha256,'market installation downloads the exact tested ZIP bytes over HTTP');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8')),manifest);
    }
    await wait(()=>H.evalIn(settings,"settings.pluginsList().then(list=>list.find(p=>p.id==='bili')?.status==='active')"),'plugin active: '+child.log.slice(-1000));
    return{pet,settings};
  }
  async function open(settings){await H.evalIn(settings,"settings.pluginsTogglePanel('bili')");const panel=await H.findReadyTarget(CDP,'/bili/panel/index.html','pet');await wait(()=>H.evalIn(panel,"!!document.querySelector('[name=\"owner.mid\"]') && document.querySelector('#settings-form').dataset.ready==='true' && !document.querySelector('main').inert"),'panel settings');return panel;}
  let app=await boot(true),panel=await open(app.settings);
  const state=()=>H.evalIn(panel,"pet.services.invoke('bili-control','state',[{}])");
  const task=id=>H.evalIn(panel,`pet.services.invoke('bili-control','aiTask',[{id:${JSON.stringify(id)}}])`);
  const type=async(selector,text)=>{await H.evalIn(panel,`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`);await H.cdp(panel,'Input.insertText',{text});};
  const openChat=async()=>{await H.evalIn(app.pet,'window.petAPI.openChatWindow()');chat=await H.findTarget(CDP,'/chat.html');await wait(()=>H.evalIn(chat,'!!document.querySelector(".cp-input input")'),'chat input');await H.evalIn(chat,'chatAPI.setExpanded(true)');};
  const sendChat=async text=>{await H.cdp(chat,'Emulation.setFocusEmulationEnabled',{enabled:true});await H.evalIn(chat,'document.querySelector(".cp-input input").focus();document.querySelector(".cp-input input").select()');await H.cdp(chat,'Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});await H.cdp(chat,'Input.insertText',{text});await activateButton(chat,'.cp-input input',{capture:false});submittedMessages.push(text);};
  const startWatch=async(targetValue,question)=>{const text=targetValue===WATCH?CHAT_MAIN:targetValue===BARE?BARE_LINK:'帮我看看 https://www.bilibili.com/video/'+targetValue+'/ 。'+question;await sendChat(text);return wait(()=>chatTasks.get(JSON.stringify(text)),'watch task returned through the actual chat tool result');};
  const verifyChat=async label=>{
    await wait(()=>H.evalIn(chat,`[...document.querySelectorAll('.cp-bubble-pet')].filter(node=>node.textContent===${JSON.stringify(REPLY)}).length===1`),label+' chat DOM');
    const history=await H.evalIn(chat,'chatAPI.getChatHistory({page:0,perPage:100})');
    check(history.messages.filter(item=>item.role==='pet'&&item.text===REPLY).length===1,label+' keeps the complete assistant reply exactly once');
    check(!history.messages.some(item=>item.role==='user'&&(item.text===QUESTION||item.text===REPLY||item.text===BARE_REPLY)),label+' does not fabricate an owner message');
    check(submittedMessages.every(text=>history.messages.filter(item=>item.role==='user'&&item.text===text).length===1),label+' persists each actual owner input exactly once');
    check(!history.messages.some(item=>item.role==='pet'&&(item.text.includes('WATCH_CANCEL_AI')||item.text.includes('CANCELLED_SHOULD_NOT_DELIVER'))),label+' contains no cancelled result');
    fs.writeFileSync(path.join(artifact,label+'-history.json'),JSON.stringify(history,null,2));
    const shot=await H.cdp(chat,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifact,label+'-chat.png'),Buffer.from(shot.data,'base64'));
  };
  const binary=path.join(target,'bin',process.platform+'-'+process.arch,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
  check(fs.existsSync(binary),'release ZIP contains the platform FFmpeg binary');
  if(process.platform!=='win32'){fs.chmodSync(binary,0o644);check(!(fs.statSync(binary).mode&0o111),'fixture removes FFmpeg executable bits after ZIP extraction');}
  await activateButton(panel,'#diagnostics',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#diagnostics-output').textContent.includes('ffmpeg') && !document.querySelector('#diagnostics').disabled"),'bundled FFmpeg dependency check');
  report.dependencies=await H.evalIn(panel,"document.querySelector('#diagnostics-output').textContent");
  const depsBody=JSON.parse(report.dependencies.slice(report.dependencies.indexOf('{')));
  check(depsBody.items.some(item=>item.name.startsWith('ffmpeg')&&item.ok),'bundled FFmpeg is available to the real plugin process');
  if(process.platform!=='win32')check(!!(fs.statSync(binary).mode&0o111),'verified FFmpeg restores executable permissions');
  check(await H.evalIn(panel,"document.querySelector('#account-state').textContent.includes('尚未连接')"),'plugin starts without Bilibili credentials or network writes');
  check(await H.evalIn(panel,"document.querySelector('#manual-cookie').type==='password' && document.querySelector('#manual-cookie').value===''"),'manual fallback starts with an empty password field');
  await activateButton(panel,'#account details:has(#manual-cookie) > summary',{capture:false});
  await H.evalIn(panel,"document.querySelector('#manual-cookie').focus()");await H.cdp(panel,'Input.insertText',{text:'invalid-fixture-no-network'});
  await activateButton(panel,'#manual-login',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#manual-cookie').value==='' && !document.querySelector('#manual-login').disabled && document.querySelector('#notice').textContent.includes('格式')"),'manual invalid input clears without network');
  check(await H.evalIn(panel,"!document.body.innerText.includes('invalid-fixture-no-network')"),'manual fallback never echoes submitted credential text');
  // The fake account is entered through the actual password field. Only this
  // isolated fixture's transport can validate it; no real cookie is read.
  await type('#manual-cookie','SESSDATA=fixture-watch-session; bili_jct='+'a'.repeat(32)+'; buvid3=fixture-watch-buvid');
  await activateButton(panel,'#manual-login',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#account-state').textContent.includes('UID 111')"),'fixture Bili login');
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>!value.enabled&&value.owner.mid==='')"),'manual watching is available with autonomous mode off and empty owner UID');
  if(repro){
    await activateClosingButton(CDP,panel,'#close-panel');await openChat();await sendChat(CHAT_MAIN);
    await wait(()=>missingWatchTool,'baseline chat discovers no dedicated watch tool');
    await wait(()=>H.evalIn(chat,'document.body.innerText.includes("CHAT_WATCH_TOOL_MISSING")'),'baseline chat symptom visible');
    report.reproduction={missingWatchTool,chatRequests,mediaRequests,claim:'The chat has generic bili_command but no discoverable dedicated watch schema; this does not prove the old general command can never work.'};
    check(mediaRequests.length===0,'baseline dedicated-watch chat path starts no media task');
    await H.captureScreenshot(chat,path.join(artifact,'missing-chat-watch-tool.png'));
    await H.stopOwned(child);report.ownedElectronStopped=child.exitCode!==null||child.signalCode!==null;child=null;report.ok=true;console.log('PASS baseline reproduction: real chat has generic Bili commands but no dedicated video-watch schema; no media task started');return;
  }

  check(await H.evalIn(panel,"!document.querySelector('#watch-form')&&!document.querySelector('#watch-target')&&document.body.innerText.includes('聊天')"),'the panel explains chat entry instead of providing a second watch composer');
  await activateClosingButton(CDP,panel,'#close-panel');check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'plugin panel is closed before the owner sends a video link');
  await openChat();
  const watched=await startWatch(WATCH,QUESTION);
  await wait(()=>pendingMain,'chat-triggered media reaches the real Harness model');
  check(modelRequests.length===1&&modelRequests[0].tools.length===0,'chat watching uses one tool-free analysis call after the main chat starts the task');
  check(modelRequests[0].imageCount>0&&modelRequests[0].images.every(image=>image.jpeg&&image.bytes>1000),'actual extracted JPEG bytes reach the model');
  check(modelRequests[0].hasQuestion&&modelRequests[0].hasVideo,'the owner chat question and actual video metadata reach the model');
  check(mediaRequests.filter(id=>id===WATCH).length===1,'one chat request starts exactly one video download');
  check(chatRequests.some(request=>request.tools.some(name=>name.endsWith('bili_watch_video')))&&chatRequests.some(request=>request.hasToolResult),'the real main Harness receives and executes the dedicated watch tool');
  check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'starting from chat never opens the plugin panel');
  await sendChat('你先继续看，我去倒杯水。');
  await wait(()=>H.evalIn(chat,'document.body.innerText.includes("ORDINARY_CHAT_DURING_WATCH")'),'another main-chat turn completes while watching is pending');
  check(modelRequests.length===1,'an ordinary chat turn does not duplicate the pending watch analysis');
  pendingMain();pendingMain=null;
  await verifyChat('watched');
  panel=await open(app.settings);
  await activateButton(panel,'[data-tab=tasks]',{capture:false});
  await wait(()=>H.evalIn(panel,`document.querySelector('#watch-result').textContent===${JSON.stringify(REPLY)}`),'complete fallback result after reopening');
  const completed=await task(watched.taskId);
  check(completed.status==='completed'&&completed.delivery==='chat'&&completed.journal==='saved','chat entry completes watching, journaling and final chat delivery without a panel submission');
  check(REPLY.length>700&&await H.evalIn(panel,"document.querySelector('#watch-result').textContent.endsWith('WATCH_REPLY_COMPLETE_END')"),'panel reopening restores the complete result beyond state summary truncation');
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','diary',[{}]).then(value=>value.text.includes('WATCH_REPLY_COMPLETE_END'))"),'the public diary contains the actual final observation');
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','diary',[{private:true}]).then(value=>value.text.includes('WATCH_REPLY_COMPLETE_END'))"),'the private diary contains the same completed experience');
  const stored=JSON.parse(fs.readFileSync(path.join(target,'data.json'),'utf8'));
  const roots=Object.entries(stored).filter(([key,value])=>/^bili\.engine\..*\.rootId$/.test(key)&&typeof value==='string').map(([,value])=>value);
  const cacheFiles=roots.flatMap(id=>{const directory=path.join(os.homedir(),'.desktop-pet-plugin-data','bilibili',id,'111','.dsh','shots','video');return fs.existsSync(directory)?fs.readdirSync(directory).map(name=>path.join(directory,name)):[];});
  check(cacheFiles.some(file=>path.basename(file).startsWith(WATCH)&&file.endsWith('.mp4')&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===crypto.createHash('sha256').update(sourceVideo).digest('hex')),'actual loopback video bytes were downloaded into the scoped engine cache');
  const cachedImages=cacheFiles.filter(file=>file.endsWith('.jpg')).map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  check(modelRequests[0].images.some(image=>cachedImages.includes(image.sha256)),'the model receives a real FFmpeg output image from the plugin cache');
  await H.evalIn(chat,'setTimeout(()=>chatAPI.close(),0);true');check(await H.waitTargetGone(CDP,'/chat.html'),'chat window closes');await openChat();await verifyChat('reopened-watch');
  await activateClosingButton(CDP,panel,'#close-panel');
  const bareTask=await startWatch(BARE,'');await wait(()=>pendingMain,'bare link starts image analysis without extra instructions');pendingMain();pendingMain=null;
  await wait(()=>H.evalIn(chat,`[...document.querySelectorAll('.cp-bubble-pet')].filter(node=>node.textContent===${JSON.stringify(BARE_REPLY)}).length===1`),'bare video link receives one final chat reply');
  check(mediaRequests.filter(id=>id===BARE).length===1,'a bare official video link starts exactly one download');
  const beforeMediaCancel=modelRequests.length;
  const mediaTask=await startWatch(CANCEL_MEDIA,'WATCH_CANCEL_MEDIA：取消下载阶段');
  await wait(()=>mediaRequests.includes(CANCEL_MEDIA),'held media download');
  await sendChat('取消刚才的视频观看');await wait(()=>mediaCancelled,'chat cancellation closes the media connection');
  check(modelRequests.length===beforeMediaCancel,'cancelling media from chat never starts an analysis call');
  const aiTask=await startWatch(CANCEL_AI,'WATCH_CANCEL_AI：取消模型分析阶段');
  await wait(()=>modelRequests.some(request=>request.question==='cancel-ai'),'held model analysis');
  await sendChat('取消这次视频观看');await wait(()=>aiCancelled,'chat cancellation closes the analysis connection');
  check(modelRequests.length===3&&modelRequests.every(request=>request.tools.length===0),'two successful watches and one cancelled analysis each use at most one tool-free analysis call');
  panel=await open(app.settings);
  check((await task(mediaTask.taskId)).status==='cancelled'&&(await task(aiTask.taskId)).status==='cancelled','both chat cancellation requests stop only their target task');
  check((await task(bareTask.taskId)).status==='completed','bare-link watching completed in the same current pet');
  await verifyChat('cancelled-watch');
  report.watch={taskId:watched.taskId,bareTaskId:bareTask.taskId,modelRequests,chatRequests,mediaRequests,biliRequests,defaultAutonomousOff:true,emptyOwner:true,mediaCancelled,aiCancelled};
  await activateButton(panel,'[data-tab=settings]',{capture:false});
  await H.evalIn(panel,"document.querySelector('[name=\"owner.mid\"]').focus()");await H.cdp(panel,'Input.insertText',{text:'123456789'});
  await H.evalIn(panel,"document.querySelector('[name=\"owner.name\"]').focus()");await H.cdp(panel,'Input.insertText',{text:'测试主人'});
  await activateButton(panel,'#settings-form button[type=submit]',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#notice').textContent==='设置已保存。'"),'saved through panel service');
  check(await H.evalIn(panel,"!document.querySelector('[name=enabled]').checked"),'saving keeps autonomous network activity paused');
  await H.evalIn(panel,'document.fonts.ready');const shot=await H.cdp(panel,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifact,'settings.png'),Buffer.from(shot.data,'base64'));
  await activateButton(panel,'[data-tab=tools]',{capture:false});
  await activateButton(panel,'#tools details summary',{capture:false});
  await H.evalIn(panel,"document.querySelector('#command-args').focus()");await H.cdp(panel,'Input.insertText',{text:'[\"help\"]'});
  await activateButton(panel,'#run-command',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#operation-output').textContent.includes('bili <命令>') && !document.querySelector('#run-command').disabled"),'local command help through actual panel and worker');
  check(true,'command help is reachable without Bilibili credentials');
  check(await H.evalIn(panel,"!!document.querySelector('#choose-image') && !document.querySelector('#choose-image').disabled && document.querySelector('#dynamic-publish').disabled"),'image selection is available and publishing requires checking first');
  await H.evalIn(panel,"document.querySelector('#choose-image').scrollIntoView({block:'center'})");
  const toolsShot=await H.cdp(panel,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifact,'dynamic.png'),Buffer.from(toolsShot.data,'base64'));
  check(await H.evalIn(panel,"!!document.querySelector('#choose-text') && document.querySelector('#edit-dynamic-save').disabled"),'dynamic editing has a text import and explicit check-before-save controls');
  await H.evalIn(panel,"document.querySelector('#edit-dynamic-text').focus()");await H.cdp(panel,'Input.insertText',{text:'本地编辑夹具，尚未发布'});
  const editShot=await H.cdp(panel,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifact,'edit-dynamic.png'),Buffer.from(editShot.data,'base64'));
  await H.evalIn(panel,"document.querySelector('#close-panel').scrollIntoView({block:'center'})");
  const closeShot=await H.cdp(panel,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifact,'close-control.png'),Buffer.from(closeShot.data,'base64'));
  await activateClosingButton(CDP,panel,'#close-panel');check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'visible close button closes the panel');
  check(await H.evalIn(app.settings,"settings.pluginsList().then(list=>list.find(p=>p.id==='bili')?.status==='active')"),'closing the panel leaves the plugin active');
  panel=await open(app.settings);check(await H.evalIn(panel,"document.querySelector('[name=\"owner.mid\"]').value==='123456789'"),'settings survive close and reopen');
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','state',[{}]).then(value=>value.account?.mid==='111'&&!value.enabled)"),'reopening preserves the fixture account and keeps autonomous activity paused');
  await activateButton(panel,'[data-tab=account]',{capture:false});
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'nienie'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='')").catch(()=>false),'new pet scoped state');
  await wait(()=>H.evalIn(panel,"!document.querySelector('main').inert && document.querySelector('[name=\"owner.mid\"]').value===''"),'panel resets visible owner on pet switch');
  check(true,'switching current pet does not reuse owner configuration');
  check(await H.evalIn(panel,"!document.querySelector('#watch-target')&&document.querySelector('#watch-result').textContent===''"),'switching pet clears the old watch result');
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'qiqi'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')").catch(()=>false),'restored prior pet scoped state');
  check(true,'returning to previous pet restores its own configuration');
  // Exercise the production 20s timer and planner, without manually enqueuing a task.
  // The model response above is a lifecycle fixture; live Bilibili content quality
  // is outside this deterministic scheduler regression.
  const end=new Date(Date.now()+120000),hhmm=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  const schedule={enabled:true,night:{windows:[{start:hhmm(new Date()),end:hhmm(end),wakes:1}],skipChance:0},share:{enabled:false},diary:{push:false},listen:{dm:false,comment:false,live:false}};
  await H.evalIn(panel,`pet.services.invoke('bili-control','saveSettings',[${JSON.stringify(schedule)}])`);
  let scheduled;
  for(let attempt=0;attempt<180;attempt++){
    scheduled=(await state()).tasks.find(t=>t.kind==='night'&&t.status==='completed');
    if(scheduled)break;await H.sleep(1000);
  }
  check(scheduled?.delivery==='shared','production timer schedules night work and shares completed result');
  check(nightRequests===1,'scheduled share reuses exactly one final model response');
  await H.evalIn(panel,"pet.services.invoke('bili-control','saveSettings',[{enabled:false}])");
  await openChat();
  await wait(()=>H.evalIn(chat,`[...document.querySelectorAll('.cp-bubble-pet')].filter(n=>n.textContent===${JSON.stringify(NIGHT_REPLY)}).length===1`),'scheduled result in chat');
  const scheduledHistory=await H.evalIn(chat,'chatAPI.getChatHistory({page:0,perPage:100})');
  const scheduledMessage=scheduledHistory.messages.find(m=>m.text===NIGHT_REPLY);
  const notices=JSON.parse(fs.readFileSync(path.join(profile,'activity-hub.json'),'utf8')).records.filter(r=>r.chatMessageId===scheduledMessage.id);
  check(notices.length===1&&notices[0].readAt===null,'Bili scheduled result has exactly one unread hub reference');
  report.scheduled={task:scheduled,message:scheduledMessage,notice:notices[0],modelFixture:true};
  await H.stopOwned(child);fs.writeFileSync(path.join(artifact,'electron-first.log'),child.log);child=null;
  app=await boot();panel=await open(app.settings);
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')"),'settings survive a fresh Electron process');
  await openChat();await verifyChat('restarted-watch');
  check(nightRequests===1,'restart never replays scheduled work');
  check((await H.evalIn(chat,'chatAPI.getChatHistory({page:0,perPage:100})')).messages.filter(m=>m.text===NIGHT_REPLY).length===1,'scheduled reply persists exactly once after restart');
  check(modelRequests.length===3,'a fresh Electron process reads the saved reply without replaying media or AI');
  const removed=await H.evalIn(app.settings,"settings.pluginsRemove('bili')");
  check(removed.ok,'removing an external plugin succeeds');
  await wait(()=>H.evalIn(app.settings,"settings.pluginsList().then(list=>!list.some(p=>p.id==='bili'))"),'removed plugin');
  check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'unloading closes its panel and deactivates tool process');
  await H.stopOwned(child);report.ownedElectronStopped=child.exitCode!==null||child.signalCode!==null;fs.writeFileSync(path.join(artifact,'electron-second.log'),child.log);child=null;
  const portClosed=await fetch('http://127.0.0.1:'+CDP+'/json',{signal:AbortSignal.timeout(1000)}).then(()=>false).catch(()=>true);check(report.ownedElectronStopped&&portClosed,'owned Electron exits and releases its CDP port');
  const rows=fs.readFileSync(path.join(artifact,'native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  check(rows.length>0 && rows.every(row=>!row.isVisible&&!row.isFocused),'all native windows hidden before painting');
  const network=fs.readFileSync(networkAudit,'utf8').trim().split('\n').map(JSON.parse);
  check(new Set(network.filter(row=>row.kind==='loaded').map(row=>row.pid)).size>=3,'network fixture reaches the actual utility process and CLI workers');
  check(biliRequests.length>0&&biliRequests.every(row=>row.method==='GET')&&network.filter(row=>row.kind==='bili').every(row=>row.method==='GET'),'all Bilibili fixture operations are read-only');
  fs.writeFileSync(path.join(artifact,'watch-network.json'),JSON.stringify(network,null,2));
  report.ok=true;console.log('PASS real plugin Electron: real input, download and FFmpeg, single image AI, chat delivery, cancellation, close/reopen/restart, scope separation and unload cleanup');
}catch(error){report.ok=false;report.error=error.stack;if(chat)await H.captureScreenshot(chat,path.join(artifact,'failure-chat.png')).catch(()=>{});if(child){fs.writeFileSync(path.join(artifact,'electron-failure.log'),child.log);try{const failedPanel=await H.findTarget(CDP,'/bili/panel/index.html');report.panelFailure=await H.evalIn(failedPanel,'document.body.innerText');}catch{}}console.error(error);process.exitCode=1;}
finally{if(child){await H.stopOwned(child);report.ownedElectronStopped=child.exitCode!==null||child.signalCode!==null;}if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.ownedMockServerClosed=server.address()===null;}report.fixture={submittedMessages,modelRequests,chatRequests,biliRequests,mediaRequests,mediaCancelled,aiCancelled,registryRequests,packageDownloads};fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));}
})().finally(()=>process.exit(process.exitCode||0));
