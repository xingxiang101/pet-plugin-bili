'use strict';
// Verify the reviewed ZIP through the real market UI and permission dialog.
// --official uses the host's default registry and actual Release download.
// Account login alone is a loopback fixture; no Bilibili account or AI is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
assert(process.env.PET_PLUGIN_HOST_DIR,'Set PET_PLUGIN_HOST_DIR to the real host/demo');
const HOST=path.resolve(process.env.PET_PLUGIN_HOST_DIR),ROOT=path.resolve(__dirname,'..');
const H=require(path.join(HOST,'../tests/e2e-helpers'));
const {activateButton,activateClosingButton}=require(path.join(HOST,'../tests/e2e/html-card-input'));
const {readEntries,readEntryData}=require(path.join(HOST,'core/plugin-runtime/zip'));
const online=process.argv.includes('--official'),port=Number(process.env.PET_BILI_MARKET_CDP_PORT)||9490;
const zip=fs.readFileSync(process.env.PET_BILI_PLUGIN_ZIP||path.join(ROOT,'dist','bili-'+require('../package.json').version+'.zip'));
const entries=readEntries(zip),manifest=JSON.parse(readEntryData(zip,entries.find(e=>e.name==='manifest.json')));
const permissions=[...new Set([...manifest.permissions,...manifest.services.map(s=>'service:'+s)])];
const sha256=crypto.createHash('sha256').update(zip).digest('hex');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-pet-bili-market-'));
const artifact=path.join(ROOT,'artifacts',online?'market-official':'market-candidate');fs.mkdirSync(artifact,{recursive:true});
const report={online,profile,version:manifest.version,sha256,checks:[]};let child,server,settings,localDownloads=0;
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);console.log('PASS',label);};
async function wait(fn,label,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await H.sleep(150);}throw Error('Timeout: '+label);}
async function shot(page,name){await H.captureScreenshot(page,path.join(artifact,name+'.png'));}
(async()=>{try{
 H.requireNode22();fs.writeFileSync(path.join(artifact,'native.jsonl'),'');
 let base;
 server=http.createServer(async(req,res)=>{
  for await(const chunk of req){} // Discard fixture login input; never record credentials.
  res.setHeader('content-type','application/json');
  if(req.url==='/plugin.zip'){localDownloads++;res.setHeader('content-type','application/zip');return res.end(zip);}
  if(req.url==='/registry/plugins.json')return res.end(JSON.stringify({schemaVersion:1,plugins:[{id:manifest.id,name:manifest.name,description:manifest.description,version:manifest.version,minHostVersion:manifest.minHostVersion,apiVersion:manifest.apiVersion,platforms:manifest.platforms,permissions,nodeAccess:true,repo:'xingxiang101/pet-plugin-bili',download:base+'/plugin.zip',sha256}]}));
  if(req.url==='/registry/blocklist.json')return res.end(JSON.stringify({schemaVersion:1,blocked:[]}));
  if(req.url.includes('/phone/verify'))return res.end(JSON.stringify({phoneProof:'market-fixture',expiresIn:600}));
  return res.end(JSON.stringify({environment:'test',accessToken:'fixture.access',refreshToken:'fixture.refresh',expiresIn:3600,user:{uid:101,nickname:'fixture',character:'qiqi'},uid:101,nickname:'fixture',character:'qiqi'}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 // Represent a user who previously removed the bundle. No grants or market cache.
 fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({onboarding:{completed:true},character:'qiqi',tts:{enabled:false},general:{autoCheckUpdates:false},relay:{url:''},plugins:{bundledSeeds:{bili:{status:'removed'}},...(online?{}:{registrySources:[base+'/registry']})}}));
 fs.writeFileSync(profile+'.environment-selection.json',JSON.stringify({environment:'test'}));
 child=H.launch({userData:profile,cdpPort:port,bootstrap:path.join(HOST,'../tests/helpers/appearance-hidden-bootstrap.js'),env:{PET_E2E_TEST:'1',PET_E2E_USE_MOCK_KEYCHAIN:'1',PET_PUBLIC_NATIVE_LOG:path.join(artifact,'native.jsonl'),PET_E2E_ENV_CONFIG:JSON.stringify({test:{accountApiBase:base+'/api',analyticsEvents:'',agentTrace:'',diagnostics:''}})}});
 await wait(async()=>{try{return(await(await fetch('http://127.0.0.1:'+port+'/json')).json()).length>0;}catch{return false;}},'CDP');
 await H.sleep(1200);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 if(pages.some(p=>p.url.includes('trial-entry.html'))){
  const login=await H.findReadyTarget(port,'trial-entry.html','trialAccess');
  await H.evalIn(login,"document.querySelector('#phone').focus()");await H.cdp(login,'Input.insertText',{text:'19977776661'});
  await H.evalIn(login,"document.querySelector('#sms').focus()");await H.cdp(login,'Input.insertText',{text:'123456'});
  await activateButton(login,'.primary',{capture:false});check(await H.waitTargetGone(port,'trial-entry.html'),'fixture login uses real input');
 }
 const pet=await H.findReadyTarget(port,'/index.html','petAPI');await H.evalIn(pet,'petAPI.openSettings("plugins")');
 settings=await H.findReadyTarget(port,'settings.html','settings');
 const index=await H.evalIn(settings,'settings.pluginsRegistryList({refresh:true})'),entry=index.plugins?.find(p=>p.id==='bili');
 assert(entry&&index.fetched,'registry returned Bili');
 check(online?index.sources.every(s=>!s.includes('127.0.0.1')):index.sources[0]===base+'/registry','host uses the intended registry without a prewritten cache');
 for(const key of ['version','minHostVersion','apiVersion'])assert.equal(entry[key],manifest[key]);
 assert.equal(entry.sha256,sha256);assert.deepEqual(entry.permissions,permissions);assert.deepEqual(entry.platforms,manifest.platforms);assert.equal(entry.nodeAccess,true);
 if(online)assert.equal(entry.download,'https://github.com/xingxiang101/pet-plugin-bili/releases/download/v'+manifest.version+'/bili-'+manifest.version+'.zip');
 report.entry=entry;check(true,'live entry matches the actual release version, digest, host floor and permissions');
 check(!(await H.evalIn(settings,'settings.pluginsList()')).some(p=>p.id==='bili'),'plugin is absent before installation');
 await activateButton(settings,'[data-field="plugin-tab-market"]');
 const selector='[data-market-id="bili"] [data-action="market-install"]';await wait(()=>H.evalIn(settings,`!!document.querySelector(${JSON.stringify(selector)})`),'market install button');
 await activateButton(settings,selector);await wait(()=>H.evalIn(settings,'!!document.querySelector("[data-action=market-perm-confirm]")'),'market permissions');
 await shot(settings,'market-permissions');await activateButton(settings,'[data-action="market-perm-confirm"]');
 const dialog=await H.findReadyTarget(port,'dialog.html','dialogAPI',1260);await shot(dialog,'host-permissions');
 await activateClosingButton(port,dialog,'.btn-primary');
 await wait(()=>H.evalIn(settings,"settings.pluginsList().then(ps=>ps.some(p=>p.id==='bili'&&p.status==='active'))"),'plugin active');
 const target=path.join(profile,'plugins','bili');
 for(const e of entries.filter(e=>!e.name.endsWith('/')))assert.deepEqual(fs.readFileSync(path.join(target,e.name)),readEntryData(zip,e),e.name);
 check(true,'every installed package file matches the reviewed release ZIP');
 const cfg=JSON.parse(fs.readFileSync(path.join(profile,'config.json')));assert.deepEqual(cfg.plugins.grants.bili.granted,permissions);
 check(true,'full permissions are granted only after the real consent dialog');
 await H.evalIn(settings,"settings.pluginsTogglePanel('bili')");const panel=await H.findReadyTarget(port,'/bili/panel/index.html','pet');
 await wait(()=>H.evalIn(panel,"document.querySelector('#account-state')?.textContent.includes('尚未连接')"),'anonymous plugin panel');
 await shot(panel,'installed-panel');
 check(await H.evalIn(panel,"pet.services.invoke('bili-control','settings',[{}]).then(s=>!s.enabled)"),'autonomous activity remains disabled after installation');
 check((await H.evalIn(settings,"settings.pluginsRemove('bili')")).ok,'installed market plugin can be removed');
 check(online?localDownloads===0:localDownloads===1,'installation used the intended package server');
 await H.stopOwned(child);fs.writeFileSync(path.join(artifact,'host.log'),child.log);child=null;
 const native=fs.readFileSync(path.join(artifact,'native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 check(native.length>0&&native.every(r=>!r.isVisible&&!r.isFocused),'all native windows remain hidden and unfocused');
 report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;console.error(error);process.exitCode=1;if(settings)await shot(settings,'failure').catch(()=>{});}
finally{
 if(child){await H.stopOwned(child);fs.writeFileSync(path.join(artifact,'host.log'),child.log);}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 report.localDownloads=localDownloads;fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));
}})().finally(()=>process.exit(process.exitCode||0));
