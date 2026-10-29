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
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-pet-bili-'));
const artifact=path.join(ROOT,'artifacts','electron-e2e');fs.mkdirSync(artifact,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
const WATCH='BV1234567890',CANCEL_MEDIA='BV2234567890',CANCEL_AI='BV3234567890';
const QUESTION='WATCH_MAIN：画面是什么样的？请明确区分抽帧观察与声音。';
const REPLY='我看到了视频抽帧中的彩色测试图。这里只能确认画面采样，没有音轨或字幕依据。\n'+('这次观察来自实际下载的视频截图，彩色方格与变化的图案清晰可见。'.repeat(35))+'\nWATCH_REPLY_COMPLETE_END';
const networkAudit=path.join(profile,'watch-network.jsonl'),modelRequests=[],biliRequests=[],mediaRequests=[];
let pendingMain,mediaCancelled=false,aiCancelled=false;
let child,server;const report={profile,host:HOST,zip:ZIP,sha256:crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex'),checks:[]};
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
    if(url.pathname==='/v1/chat/completions'){
      const body=JSON.parse(raw),prompt=JSON.stringify(body.messages),images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(part=>part.type==='image_url').map(part=>part.image_url.url);
      modelRequests.push({question:prompt.includes('WATCH_CANCEL_AI')?'cancel-ai':'main',tools:(body.tools||[]).map(tool=>tool.function?.name),imageCount:images.length,images:images.map(image=>{const bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64');return{sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,jpeg:bytes[0]===0xff&&bytes[1]===0xd8};}),hasQuestion:prompt.includes(QUESTION),hasVideo:prompt.includes('本地四秒彩色测试图')});
      res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting for fixture completion\n\n');
      if(prompt.includes('WATCH_CANCEL_AI')){res.on('close',()=>{if(!res.writableEnded)aiCancelled=true;});return;}
      pendingMain=()=>finishModel(res,REPLY);return;
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
      if(url.pathname.endsWith('/playurl'))return res.end(JSON.stringify({code:0,data:{quality:64,durl:[{url:'http://127.0.0.1:'+server.address().port+'/media/'+url.searchParams.get('bvid')+'.mp4'}]}}));
      res.statusCode=404;return res.end(JSON.stringify({code:-404,message:'unexpected test read'}));
    }
    if(req.url.includes('/api/activation/'))return res.end(JSON.stringify(req.url.includes('/phone/verify')?{phoneProof:'bili-fixture',expiresIn:600}:{environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'}}));
    if(req.url.startsWith('/api/'))return res.end(JSON.stringify({environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'},uid:101,nickname:'fixture',character:'qiqi'}));
    res.end(JSON.stringify({schemaVersion:1,plugins:[],blocked:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({onboarding:{completed:true},character:'qiqi',petName:'插件测试宠物',tts:{enabled:false},general:{autoCheckUpdates:false},behavior:{walk:false,sleep:false},relay:{url:''},ai:{source:'manual',provider:'openai-compatible',baseUrl:base+'/v1',apiKey:'fixture-local-key',model:'watch-fixture'},plugins:{registrySources:[base],grants:{bili:{granted:[...manifest.permissions,'service:bili-control'],version:manifest.version,at:Date.now()}}}}));
  fs.writeFileSync(profile+'.environment-selection.json',JSON.stringify({environment:'test'}));
  async function boot(install=false){
    child=H.launch({userData:profile,cdpPort:CDP,bootstrap:path.join(HOST,'../tests/helpers/appearance-hidden-bootstrap.js'),env:{PET_E2E_TEST:'1',PET_E2E_USE_MOCK_KEYCHAIN:'1',PET_PUBLIC_NATIVE_LOG:path.join(artifact,'native.jsonl'),PET_BILI_E2E_FIXTURE_BASE:base,PET_BILI_E2E_NETWORK_AUDIT:networkAudit,NODE_OPTIONS:'--require='+JSON.stringify(path.join(ROOT,'tests/helpers/watch-network-fixture.cjs')),PET_E2E_ENV_CONFIG:JSON.stringify({test:{accountApiBase:base+'/api',analyticsEvents:'',agentTrace:'',diagnostics:''}})}});
    await wait(async()=>{try{return(await fetch('http://127.0.0.1:'+CDP+'/json').then(r=>r.json())).length>0;}catch{return false;}},'CDP');
    await H.sleep(1200);
    const pages=await fetch('http://127.0.0.1:'+CDP+'/json').then(r=>r.json());
    if(pages.some(p=>p.url.includes('trial-entry.html'))){const login=await H.findReadyTarget(CDP,'trial-entry.html','trialAccess');await H.evalIn(login,"document.querySelector('#phone').focus()");await H.cdp(login,'Input.insertText',{text:'19977776661'});await H.evalIn(login,"document.querySelector('#sms').focus()");await H.cdp(login,'Input.insertText',{text:'123456'});await activateButton(login,'.primary',{capture:false});check(await H.waitTargetGone(CDP,'trial-entry.html'),'host login uses real input');}
    const pet=await H.findTarget(CDP,'/index.html');await wait(()=>H.evalIn(pet,'!!window.petAPI'),'pet API');
    await H.evalIn(pet,'window.petAPI.openSettings("plugins")');const settings=await H.findReadyTarget(CDP,'settings.html','settings');
    if(install){const installed=await H.evalIn(settings,`settings.pluginsInstallZip(${JSON.stringify({path:ZIP,sha256:report.sha256,expectPermissions:[...manifest.permissions,'service:bili-control']})})`);check(installed.ok,'release ZIP installs through the host SHA256 and permissions pipeline: '+JSON.stringify(installed));}
    await wait(()=>H.evalIn(settings,"settings.pluginsList().then(list=>list.find(p=>p.id==='bili')?.status==='active')"),'plugin active: '+child.log.slice(-1000));
    return{pet,settings};
  }
  async function open(settings){await H.evalIn(settings,"settings.pluginsTogglePanel('bili')");const panel=await H.findReadyTarget(CDP,'/bili/panel/index.html','pet');await wait(()=>H.evalIn(panel,"!!document.querySelector('[name=\"owner.mid\"]') && document.querySelector('#settings-form').dataset.ready==='true' && !document.querySelector('main').inert"),'panel settings');return panel;}
  let app=await boot(true),panel=await open(app.settings);
  const state=()=>H.evalIn(panel,"pet.services.invoke('bili-control','state',[{}])");
  const task=id=>H.evalIn(panel,`pet.services.invoke('bili-control','aiTask',[{id:${JSON.stringify(id)}}])`);
  const type=async(selector,text)=>{await H.evalIn(panel,`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`);await H.cdp(panel,'Input.insertText',{text});};
  const startWatch=async(targetValue,question)=>{
    await wait(()=>H.evalIn(panel,"!document.querySelector('#watch-submit').disabled"),'watch ready');
    await type('#watch-target',targetValue);await type('#watch-question',question);
    await activateButton(panel,'#watch-submit',{capture:false});
    return wait(async()=>{const value=await state();return value.tasks.find(item=>item.source==='watch'&&item.request===question);},'submitted watch task');
  };
  let chat;
  const openChat=async()=>{await H.evalIn(app.pet,'window.petAPI.openChatWindow()');chat=await H.findTarget(CDP,'/chat.html');await wait(()=>H.evalIn(chat,'!!document.querySelector(".cp-input input")'),'chat input');await H.evalIn(chat,'chatAPI.setExpanded(true)');};
  const verifyChat=async label=>{
    await wait(()=>H.evalIn(chat,`[...document.querySelectorAll('.cp-bubble-pet')].filter(node=>node.textContent===${JSON.stringify(REPLY)}).length===1`),label+' chat DOM');
    const history=await H.evalIn(chat,'chatAPI.getChatHistory({page:0,perPage:100})');
    check(history.messages.filter(item=>item.role==='pet'&&item.text===REPLY).length===1,label+' keeps the complete assistant reply exactly once');
    check(!history.messages.some(item=>item.role==='user'&&(item.text===QUESTION||item.text===REPLY)),label+' does not fabricate an owner message');
    check(!history.messages.some(item=>item.text.includes('WATCH_CANCEL_AI')||item.text.includes('CANCELLED_SHOULD_NOT_DELIVER')),label+' contains no cancelled result');
    fs.writeFileSync(path.join(artifact,label+'-history.json'),JSON.stringify(history,null,2));
    await H.captureScreenshot(chat,path.join(artifact,label+'-chat.png'));
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
  await wait(()=>H.evalIn(panel,"document.querySelector('#account-state').textContent.includes('UID 111') && !document.querySelector('#watch-submit').disabled"),'fixture Bili login');
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>!value.enabled&&value.owner.mid==='')"),'manual watching is available with autonomous mode off and empty owner UID');
  check(await H.evalIn(panel,"document.querySelector('#account').classList.contains('active') && !!document.querySelector('#watch-form')"),'watch input is present on the first account screen');
  await type('#watch-target','https://www.bilibili.com/video/'+WATCH+'/');await type('#watch-question',QUESTION);
  await H.sleep(5300);
  check(await H.evalIn(panel,`document.querySelector('#watch-target').value===${JSON.stringify('https://www.bilibili.com/video/'+WATCH+'/')}&&document.querySelector('#watch-question').value===${JSON.stringify(QUESTION)}`),'automatic status refresh preserves an unsent link and question');
  await openChat();
  const watched=await startWatch('https://www.bilibili.com/video/'+WATCH+'/',QUESTION);
  await wait(()=>pendingMain,'media reaches the real Harness model');
  check(modelRequests.length===1&&modelRequests[0].tools.length===0,'fixed manual watching uses exactly one model call without tools');
  check(modelRequests[0].imageCount>0&&modelRequests[0].images.every(image=>image.jpeg&&image.bytes>1000),'actual extracted JPEG bytes reach the model');
  check(modelRequests[0].hasQuestion&&modelRequests[0].hasVideo,'the entered question and actual video metadata reach the model');
  check((await task(watched.id)).stage==='analysis','watch progress reaches analysis after media completion');
  await H.evalIn(panel,"document.querySelector('#close-panel').scrollIntoView({block:'center'})");
  await activateClosingButton(CDP,panel,'#close-panel');check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'panel closes while the model is running');
  pendingMain();pendingMain=null;
  await verifyChat('watched');
  panel=await open(app.settings);
  await wait(()=>H.evalIn(panel,`document.querySelector('#watch-result').textContent===${JSON.stringify(REPLY)}`),'complete fallback result after reopening');
  const completed=await task(watched.id);
  check(completed.status==='completed'&&completed.delivery==='chat'&&completed.journal==='saved','closing the panel does not cancel watching, journaling or chat delivery');
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
  const beforeMediaCancel=modelRequests.length;
  const mediaTask=await startWatch(CANCEL_MEDIA,'WATCH_CANCEL_MEDIA：取消下载阶段');
  await wait(()=>mediaRequests.includes(CANCEL_MEDIA),'held media download');
  await activateButton(panel,'#watch-cancel',{capture:false});
  await wait(async()=>(await task(mediaTask.id)).status==='cancelled','media cancellation');
  await wait(()=>mediaCancelled,'media connection closed on cancellation');
  check(modelRequests.length===beforeMediaCancel,'cancelling media never starts a model call');
  const aiTask=await startWatch(CANCEL_AI,'WATCH_CANCEL_AI：取消模型分析阶段');
  await wait(()=>modelRequests.some(request=>request.question==='cancel-ai'),'held model analysis');
  await activateButton(panel,'#watch-cancel',{capture:false});
  await wait(async()=>(await task(aiTask.id)).status==='cancelled','AI cancellation');
  await wait(()=>aiCancelled,'model connection closed on cancellation');
  check(modelRequests.length===2&&modelRequests.every(request=>request.tools.length===0),'each attempted manual watch uses at most one tool-free model call');
  await verifyChat('cancelled-watch');
  report.watch={taskId:watched.id,modelRequests,mediaRequests,biliRequests,defaultAutonomousOff:true,emptyOwner:true,mediaCancelled,aiCancelled};
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
  await type('#watch-target','https://www.bilibili.com/video/'+WATCH+'/');await type('#watch-question','未提交的切换身份草稿');
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'nienie'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='')").catch(()=>false),'new pet scoped state');
  await wait(()=>H.evalIn(panel,"!document.querySelector('main').inert && document.querySelector('[name=\"owner.mid\"]').value===''"),'panel resets visible owner on pet switch');
  check(true,'switching current pet does not reuse owner configuration');
  check(await H.evalIn(panel,"document.querySelector('#watch-target').value===''&&document.querySelector('#watch-question').value===''&&document.querySelector('#watch-result').textContent===''"),'switching pet clears old watch inputs and result');
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'qiqi'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')").catch(()=>false),'restored prior pet scoped state');
  check(true,'returning to previous pet restores its own configuration');
  await H.stopOwned(child);fs.writeFileSync(path.join(artifact,'electron-first.log'),child.log);child=null;
  app=await boot();panel=await open(app.settings);
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')"),'settings survive a fresh Electron process');
  await openChat();await verifyChat('restarted-watch');
  check(modelRequests.length===2,'a fresh Electron process reads the saved reply without replaying media or AI');
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
}catch(error){report.ok=false;report.error=error.stack;if(child){fs.writeFileSync(path.join(artifact,'electron-failure.log'),child.log);try{const failedPanel=await H.findTarget(CDP,'/bili/panel/index.html');report.panelFailure=await H.evalIn(failedPanel,'document.body.innerText');}catch{}}console.error(error);process.exitCode=1;}
finally{if(child)await H.stopOwned(child);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.ownedMockServerClosed=server.address()===null;}report.fixture={modelRequests,biliRequests,mediaRequests,mediaCancelled,aiCancelled};fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));}
})().finally(()=>process.exit(process.exitCode||0));
