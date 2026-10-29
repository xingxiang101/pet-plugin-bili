'use strict';
// Real application + real plugin utilityProcess + sandboxed plugin panel.
// Account/SMS uses a bounded loopback fixture. No Bilibili login or writes occur.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const HOST=path.resolve(process.env.PET_PLUGIN_HOST_DIR||'');
if(!process.env.PET_PLUGIN_HOST_DIR)throw Error('Set PET_PLUGIN_HOST_DIR to the actual desktop-pet/demo checkout.');
const H=require(path.join(HOST,'../tests/e2e-helpers'));
const {activateButton}=require(path.join(HOST,'../tests/e2e/html-card-input'));
const ROOT=path.resolve(__dirname,'..'),ZIP=path.resolve(process.env.PET_BILI_PLUGIN_ZIP||path.join(ROOT,'dist','bili-0.1.0.zip')),CDP=Number(process.env.PET_BILI_E2E_CDP_PORT)||9488;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-pet-bili-'));
const artifact=path.join(ROOT,'artifacts','electron-e2e');fs.mkdirSync(artifact,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
let child,server;const report={profile,host:HOST,zip:ZIP,sha256:crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex'),checks:[]};
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);};
const wait=async(check,label)=>{for(let i=0;i<160;i++){const value=await check();if(value)return value;await H.sleep(100);}throw Error('Timeout: '+label);};
(async()=>{
try{
  const target=path.join(profile,'plugins','bili');
  fs.writeFileSync(path.join(artifact,'native.jsonl'),'');
  server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    res.setHeader('content-type','application/json');
    if(req.url.includes('/api/activation/'))return res.end(JSON.stringify(req.url.includes('/phone/verify')?{phoneProof:'bili-fixture',expiresIn:600}:{environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'}}));
    if(req.url.startsWith('/api/'))return res.end(JSON.stringify({environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'},uid:101,nickname:'fixture',character:'qiqi'}));
    res.end(JSON.stringify({schemaVersion:1,plugins:[],blocked:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({onboarding:{completed:true},character:'qiqi',petName:'插件测试宠物',tts:{enabled:false},general:{autoCheckUpdates:false},behavior:{walk:false,sleep:false},relay:{url:''},plugins:{registrySources:[base],grants:{bili:{granted:[...manifest.permissions,'service:bili-control'],version:manifest.version,at:Date.now()}}}}));
  fs.writeFileSync(profile+'.environment-selection.json',JSON.stringify({environment:'test'}));
  async function boot(install=false){
    child=H.launch({userData:profile,cdpPort:CDP,bootstrap:path.join(HOST,'../tests/helpers/appearance-hidden-bootstrap.js'),env:{PET_E2E_TEST:'1',PET_E2E_USE_MOCK_KEYCHAIN:'1',PET_PUBLIC_NATIVE_LOG:path.join(artifact,'native.jsonl'),PET_E2E_ENV_CONFIG:JSON.stringify({test:{accountApiBase:base+'/api',analyticsEvents:'',agentTrace:'',diagnostics:''}})}});
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
  await activateButton(panel,'#account details summary',{capture:false});
  await H.evalIn(panel,"document.querySelector('#manual-cookie').focus()");await H.cdp(panel,'Input.insertText',{text:'invalid-fixture-no-network'});
  await activateButton(panel,'#manual-login',{capture:false});
  await wait(()=>H.evalIn(panel,"document.querySelector('#manual-cookie').value==='' && !document.querySelector('#manual-login').disabled && document.querySelector('#notice').textContent.includes('格式')"),'manual invalid input clears without network');
  check(await H.evalIn(panel,"!document.body.innerText.includes('invalid-fixture-no-network')"),'manual fallback never echoes submitted credential text');
  await activateButton(panel,'[data-tab=settings]',{capture:false});
  await H.evalIn(panel,"document.querySelector('[name=\"owner.mid\"]').focus()");await H.cdp(panel,'Input.insertText',{text:'123456789'});
  await H.evalIn(panel,"document.querySelector('[name=\"owner.name\"]').focus()");await H.cdp(panel,'Input.insertText',{text:'测试主人'});
  await activateButton(panel,'button[type=submit]',{capture:false});
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
  await H.evalIn(app.settings,"settings.pluginsTogglePanel('bili')");check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'closing panel leaves background plugin active');
  panel=await open(app.settings);check(await H.evalIn(panel,"document.querySelector('[name=\"owner.mid\"]').value==='123456789'"),'settings survive close and reopen');
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'nienie'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='')").catch(()=>false),'new pet scoped state');
  await wait(()=>H.evalIn(panel,"!document.querySelector('main').inert && document.querySelector('[name=\"owner.mid\"]').value===''"),'panel resets visible owner on pet switch');
  check(true,'switching current pet does not reuse owner configuration');
  await H.evalIn(app.pet,"window.petAPI.e2eConfigPatch({character:'qiqi'})");
  await wait(()=>H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')").catch(()=>false),'restored prior pet scoped state');
  check(true,'returning to previous pet restores its own configuration');
  await H.stopOwned(child);fs.writeFileSync(path.join(artifact,'electron-first.log'),child.log);child=null;
  app=await boot();panel=await open(app.settings);
  check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(value=>value.owner.mid==='123456789')"),'settings survive a fresh Electron process');
  const removed=await H.evalIn(app.settings,"settings.pluginsRemove('bili')");
  check(removed.ok,'removing an external plugin succeeds');
  await wait(()=>H.evalIn(app.settings,"settings.pluginsList().then(list=>!list.some(p=>p.id==='bili'))"),'removed plugin');
  check(await H.waitTargetGone(CDP,'/bili/panel/index.html'),'unloading closes its panel and deactivates tool process');
  await H.stopOwned(child);report.ownedElectronStopped=child.exitCode!==null||child.signalCode!==null;fs.writeFileSync(path.join(artifact,'electron-second.log'),child.log);child=null;
  const portClosed=await fetch('http://127.0.0.1:'+CDP+'/json',{signal:AbortSignal.timeout(1000)}).then(()=>false).catch(()=>true);check(report.ownedElectronStopped&&portClosed,'owned Electron exits and releases its CDP port');
  const rows=fs.readFileSync(path.join(artifact,'native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  check(rows.length>0 && rows.every(row=>!row.isVisible&&!row.isFocused),'all native windows hidden before painting');
  report.ok=true;console.log('PASS real plugin Electron: panel settings, close/reopen, restart, pet scope separation, unload cleanup');
}catch(error){report.ok=false;report.error=error.stack;if(child){fs.writeFileSync(path.join(artifact,'electron-failure.log'),child.log);try{const failedPanel=await H.findTarget(CDP,'/bili/panel/index.html');report.panelFailure=await H.evalIn(failedPanel,'document.body.innerText');}catch{}}console.error(error);process.exitCode=1;}
finally{if(child)await H.stopOwned(child);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.ownedMockServerClosed=server.address()===null;}fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));}
})().finally(()=>process.exit(process.exitCode||0));
