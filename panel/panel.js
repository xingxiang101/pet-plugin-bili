'use strict';
const $ = selector => document.querySelector(selector);
let panelEpoch = 0;
const call = async (method, value = {}) => {const epoch=panelEpoch;const result=await window.pet.services.invoke('bili-control',method,[value]);if(epoch!==panelEpoch)throw Error('宠物身份已切换，请重新查看当前设置。');return result;};
let settings, dirty = false, loginId, loginTimer, closed = false;
let watchTaskId=null,watchLoadedId=null,watchRunning=false,watchAccountKey=null;
const statusText = { queued:'等待执行', running:'进行中', completed:'已完成', failed:'未完成', cancelled:'已取消', interrupted:'重启后待核查' };
const kindText = { night:'浏览视频', skip:'本次休息', dm:'主人私信', comment:'评论与 @', live:'直播弹幕', manual:'对话异步任务' };
function notice(message, error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (error) { notice(error?.message || '操作失败，请稍后重试。', true); }
  finally { button.disabled = false; }
}
function textNode(tag, text, cls) { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; }
function setPath(object, path, value) { const keys = path.split('.'); let target = object; for (const key of keys.slice(0,-1)) target = target[key] ||= {}; target[keys.at(-1)] = value; }
function getPath(object, path) { return path.split('.').reduce((value,key)=>value?.[key],object); }
function windowRow(value = {start:'20:00',end:'24:00',wakes:1}) {
  const row = document.createElement('div'); row.className = 'window';
  for (const [key,label,type] of [['start','开始时间','text'],['end','结束时间','text'],['wakes','浏览次数','number']]) {
    const holder = textNode('label',label); const input = document.createElement('input'); input.dataset.key = key; input.type = type; input.value = value[key]; if(type==='number'){input.min='0';input.max='12';} else input.placeholder='20:00'; holder.append(input); row.append(holder);
  }
  const remove = textNode('button','移除','quiet'); remove.type='button';remove.onclick=()=>{row.remove();markDirty();};row.append(remove);$('#windows').append(row);
}
function fillSettings(value) {
  settings = value;
  for (const input of $('#settings-form').elements) {
    if (!input.name) continue;
    const value = getPath(settings,input.name);
    if(input.type==='checkbox')input.checked=!!value;
    else if(input.name==='notify.url')input.value='';
    else input.value=Array.isArray(value)?value.join('\n'):(value??'');
  }
  $('#windows').replaceChildren(); settings.night.windows.forEach(windowRow);
  $('#webhook-status').textContent='市场版本暂未开放 Webhook 通知，已保存的地址也不会用于外发。';
  dirty=false;$('#dirty').textContent='';
}
function readSettings() {
  const next = structuredClone(settings);
  for(const input of $('#settings-form').elements){
    if(!input.name)continue;
    let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
    if(['preferences.like','preferences.dislike','preferences.keywords','notify.args','aliases','quota.scope'].includes(input.name))value=input.value.split('\n').map(s=>s.trim()).filter(Boolean);
    setPath(next,input.name,value);
  }
  next.night.windows=Array.from($('#windows').children,row=>Object.fromEntries(Array.from(row.querySelectorAll('input'),input=>[input.dataset.key,input.type==='number'?Number(input.value):input.value])));
  return next;
}
function markDirty(){dirty=true;$('#dirty').textContent='有未保存的修改';}
async function fullTask(id){
  let value,text='',offset=0;
  do{value=await call('aiTask',{id,offset});if(!value)return null;text+=value.text||'';offset=value.next;}while(offset!==null);
  return{...value,text};
}
async function refreshWatch(value){
  const accountKey=value.account?.mid||'';
  if(watchAccountKey!==null&&watchAccountKey!==accountKey){watchTaskId=null;watchLoadedId=null;$('#watch-result').textContent='';$('#watch-fallback').hidden=true;}
  watchAccountKey=accountKey;
  const task=[...value.tasks].reverse().find(task=>task.source==='watch')||null;
  if(watchTaskId!==task?.id){watchTaskId=task?.id||null;watchLoadedId=null;$('#watch-result').textContent='';$('#watch-fallback').hidden=true;}
  watchRunning=!!task&&['queued','running'].includes(task.status);
  $('#watch-cancel').hidden=!watchRunning;
  if(!task){$('#watch-status').textContent=!value.account?'连接 B 站账号后，把视频链接发给桌宠即可开始。':!value.aiAvailable||!value.chatDeliveryAvailable?'当前宿主不支持观看后回复到聊天，请更新测试宿主。':'暂无观看任务。把视频链接或 BV 号发给桌宠即可开始。';return;}
  const progress=task.status==='queued'?'已加入观看队列。':task.status==='running'?({media:'正在下载视频并抽取画面…',analysis:'正在理解画面并整理回复…',delivery:'正在把回复送到桌宠聊天…'}[task.stage]||'正在观看…'):task.status==='completed'?(task.delivery==='chat'?'看完了，已回复到桌宠聊天。':'回复已生成，但暂未送达聊天；可在下方查看完整回复。'):task.status==='cancelled'?'观看已取消。':task.error||'本次观看未完成，可查看任务记录后重试。';
  $('#watch-status').textContent=progress+(task.journal==='unavailable'?' 本次日记未完整保存，回复已保留。':'');
  if(!watchRunning&&task.text&&watchLoadedId!==task.id){
    const result=await fullTask(task.id);if(!result)return;
    $('#watch-result').textContent=result.text;$('#watch-fallback').hidden=false;$('#watch-fallback').open=task.delivery!=='chat';watchLoadedId=task.id;
  }
}
async function refreshState(){
  const value=await call('state');
  $('#account-state').textContent=value.account?`已连接：${value.account.name||'B 站账号'}（UID ${value.account.mid}）`:'尚未连接 B 站账号';
  $('#ai-state').textContent=value.aiAvailable?(value.enabled?'自主任务已启用。':'自主任务暂停中，可保存设置后启用。'):'当前宿主尚不支持后台 AI，需要更新测试宿主。';
  const list=$('#task-list');list.replaceChildren();
  for(const task of [...value.tasks].reverse()){
    const row=document.createElement('div');row.className='task';
    row.append(textNode('strong',`${kindText[task.kind]||task.kind} · ${statusText[task.status]||task.status}`),textNode('p',new Date(task.at).toLocaleString(),'time'));
    if(task.error)row.append(textNode('p',task.error));
    if(task.text){const details=document.createElement('details'),output=textNode('pre',task.text);details.append(textNode('summary','查看完整结果'),output);details.addEventListener('toggle',()=>{if(details.open&&!details.dataset.loaded)fullTask(task.id).then(value=>{if(value){output.textContent=value.text;details.dataset.loaded='true';}}).catch(error=>notice(error.message,true));});row.append(details);}
    if(['queued','running'].includes(task.status)){const button=textNode('button','取消','quiet');button.onclick=()=>action(button,async()=>{await call('cancelTask',{id:task.id});await refreshState();});row.append(button);}
    list.append(row);
  }
  if(!value.tasks.length)list.append(textNode('p','暂无后台任务。','hint'));
  $('#logs').textContent=value.logs.map(x=>`${new Date(x.at).toLocaleString()}  ${x.message}`).join('\n')||'暂无运行记录。';
  await refreshWatch(value);
}
async function refresh(){await refreshState();if(!settings||!dirty)fillSettings(await call('settings'));if(settings){$('main').inert=false;$('#settings-form').dataset.ready='true';}}
async function pollJob(id,output,images){
  for(let i=0;i<1800&&!closed;i++){
    const job=await call('job',{id});
    if(job.status==='completed'){
      output.textContent=job.result?.text||'操作已完成。';
      if(images){images.replaceChildren();for(let index=0;index<(job.result?.imageCount||0);index++){let url='',offset=0;for(;;){const part=await call('image',{id,index,offset});url+=part.chunk;if(part.next===null)break;offset=part.next;}if(!/^data:image\/(png|jpeg|webp);base64,/.test(url))continue;const img=document.createElement('img');img.src=url;img.alt='视频处理结果';images.append(img);}for(const url of job.result?.images||[]){if(!/^data:image\/(png|jpeg|webp);base64,/.test(url))continue;const img=document.createElement('img');img.src=url;img.alt='视频处理结果';images.append(img);}}
      return job;
    }
    if(['failed','cancelled'].includes(job.status)){output.textContent=job.result?.text||job.error||(job.status==='cancelled'?'操作已取消。':'操作未完成。');return job;}
    output.textContent='正在执行… 你可以继续使用其他设置。';
    await new Promise(r=>setTimeout(r,1000));
  }
  output.textContent='仍未确认结果，请在运行记录中核查，不要重复发送。';
}
async function command(args,output,images){const job=await call('runCommand',{args});const result=await pollJob(job.id,output,images);if(args[0]==='quota'&&['set','allow'].includes(args[1])){const value=await call('settings');settings.quota=value.quota;for(const name of ['quota.daily','quota.scope','quota.shareDaily']){const input=$(`[name="${name}"]`);const item=getPath(value,name);if(!input)continue;input.value=Array.isArray(item)?item.join('\n'):item;}}return result;}
async function loadDrafts(offset=0){
  const value=await call('drafts',{offset});const list=$('#draft-list');if(!offset)list.replaceChildren();list.querySelector('[data-more]')?.remove();
  for(const draft of value.items){
    const row=document.createElement('div');row.className='draft';
    row.append(textNode('strong',draft.who||'评论回复'),textNode('p',`草稿 ${draft.id} · ${new Date(draft.at).toLocaleString()}`,'time'));
    if(draft.src)row.append(textNode('blockquote',draft.src));
    row.append(textNode('p',draft.message),textNode('p',`oid=${draft.oid} · root=${draft.root} · parent=${draft.parent}`,'hint'));
    const actions=document.createElement('div');actions.className='actions';
    for(const [actionName,label]of [['approve','批准发送'],['reject','拒绝并移除']]){
      const button=textNode('button',label,actionName==='reject'?'quiet':'');
      button.onclick=()=>action(button,async()=>{
        const result=await call('reviewDraft',{id:draft.id,action:actionName});
        if(result.id){const out=textNode('pre','正在发送…');row.append(out);await pollJob(result.id,out);notice('已获得发送结果，请核对上方输出。');}
        else notice('草稿已拒绝。');
        await loadDrafts();
      });actions.append(button);
    }
    row.append(actions);list.append(row);
  }
  if(!value.items.length&&!offset)list.append(textNode('p','没有待审核的回复。','hint'));
  if(value.next!==null){const more=textNode('button','加载更多待审回复','quiet');more.dataset.more='true';more.onclick=()=>action(more,()=>loadDrafts(value.next));list.append(more);}
}
function showLogin(value){
  const qr=$('#qr');qr.hidden=false;$('#qr-state').textContent=({waiting:'使用 B 站 App 扫码登录。',scanned:'已扫码，请在 B 站 App 中确认。',success:'登录成功。',expired:'二维码已过期，请重新生成。',cancelled:'登录已取消。',error:value.error||'登录失败，请重试。'})[value.status]||value.status;
  $('#qr-image').hidden=!value.image;if(value.image)$('#qr-image').src=value.image;else $('#qr-image').removeAttribute('src');
}
async function pollLogin(){
  if(!loginId||closed)return;
  try{const value=await call('loginPoll',{id:loginId});showLogin(value);if(['success','expired','cancelled','error'].includes(value.status)){loginId=null;await refresh();return;}loginTimer=setTimeout(pollLogin,2200);}
  catch(error){notice(error.message,true);loginId=null;}
}
document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-selected',String(b===button)));document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab.id===button.dataset.tab));if(button.dataset.tab==='drafts')loadDrafts().catch(e=>notice(e.message,true));if(button.dataset.tab==='tasks')refreshState().catch(e=>notice(e.message,true));});
$('#refresh').onclick=()=>action($('#refresh'),refresh);
$('#close-panel').onclick=()=>window.pet.ui.closePanel().catch(error=>notice(error.message||'暂时无法关闭面板。',true));
$('#settings-form').addEventListener('input',markDirty);
$('#add-window').onclick=()=>{if($('#windows').children.length>=6)return;windowRow();markDirty();};
$('#settings-form').onsubmit=event=>{event.preventDefault();const button=event.submitter;action(button,async()=>{fillSettings(await call('saveSettings',readSettings()));notice('设置已保存。');await refreshState();});};
$('#manual-login').onclick=()=>action($('#manual-login'),async()=>{const input=$('#manual-cookie');const value=input.value;input.value='';if(!value.trim())throw Error('请先粘贴登录凭据。');await call('loginManual',{cookie:value});notice('B 站账号已连接。');await refresh();});
$('#login').onclick=()=>action($('#login'),async()=>{clearTimeout(loginTimer);const value=await call('loginStart');loginId=value.id;showLogin(value);pollLogin();});
$('#cancel-login').onclick=()=>action($('#cancel-login'),async()=>{clearTimeout(loginTimer);showLogin(await call('loginCancel',{id:loginId}));loginId=null;});
$('#logout').onclick=()=>action($('#logout'),async()=>{await call('logout');notice('B 站账号已退出。');await refresh();});
$('#watch-cancel').onclick=()=>action($('#watch-cancel'),async()=>{if(watchTaskId)await call('cancelTask',{id:watchTaskId});await refreshState();});
$('#diagnostics').onclick=()=>action($('#diagnostics'),()=>command(['deps','--json'],$('#diagnostics-output')));
$('#wake').onclick=()=>action($('#wake'),async()=>{await call('wake');notice('浏览任务已加入队列。');await refreshState();});
$('#load-diary').onclick=()=>action($('#load-diary'),async()=>{const value=await call('diary',{private:$('#diary-kind').value==='private'});$('#diary-output').textContent=value.text||'还没有日记。';});
$('#load-drafts').onclick=()=>action($('#load-drafts'),loadDrafts);
$('#run-operation').onclick=()=>action($('#run-operation'),async()=>{
  const op=$('#operation').value,target=$('#target').value.trim();let args=[op];
  if(['debrief','video','subtitles','comments','search'].includes(op)){if(!target)throw Error(op==='search'?'请填写搜索词。':'请填写 BV 号。');args.push(target);}
  else if(op==='fav')args.push('--list');else if(op==='dynamic')args.push('list');else if(op==='quota')args.push('status');else if(op==='traffic')args.push('status');
  await command(args,$('#operation-output'),$('#operation-images'));
});
$('#run-command').onclick=()=>action($('#run-command'),async()=>{let args;try{args=JSON.parse($('#command-args').value);}catch{throw Error('请输入 JSON 字符串数组，例如 ["quota","status"]。');}if(!Array.isArray(args)||!args.length||args.some(x=>typeof x!=='string'))throw Error('命令参数必须是字符串数组。');await command(args,$('#operation-output'),$('#operation-images'));});
let dynamicImage = null, checkedDynamic = null;
function resetDynamic(){checkedDynamic=null;$('#dynamic-publish').disabled=true;}
function dynamicArgs(){const text=$('#dynamic-text').value.trim();if(!text&&!dynamicImage)throw Error('请填写动态正文或选择图片。');return dynamicImage?['dynamic-image','--image',dynamicImage.path,'--text',text]:['dynamic','post','--text',text];}
$('#dynamic-text').addEventListener('input',resetDynamic);
$('#choose-image').onclick=()=>action($('#choose-image'),async()=>{const epoch=panelEpoch;const paths=await window.pet.files.pick({kind:'file',accept:'images'});if(epoch!==panelEpoch)throw Error('宠物身份已切换，请重新选择图片。');if(!paths?.length)return;const imported=await call('importFile',{path:paths[0]});if(!/\.(png|jpe?g|gif)$/i.test(imported.name))throw Error('图文动态需要 PNG、JPG 或 GIF 图片。');dynamicImage=imported;$('#chosen-image').textContent=`${imported.name} · ${Math.ceil(imported.bytes/1024)} KiB`;resetDynamic();});
$('#clear-image').onclick=()=>{dynamicImage=null;$('#chosen-image').textContent='纯文字动态';resetDynamic();};
$('#dynamic-check').onclick=()=>action($('#dynamic-check'),async()=>{resetDynamic();const args=dynamicArgs();const result=await command([...args,'--dry'],$('#dynamic-output'));if(result.status==='completed'&&result.result?.exitCode===0){checkedDynamic=JSON.stringify(args);$('#dynamic-publish').disabled=false;}});
$('#dynamic-publish').onclick=()=>{const button=$('#dynamic-publish');action(button,async()=>{const args=dynamicArgs();if(JSON.stringify(args)!==checkedDynamic)throw Error('内容已变化，请重新检查。');resetDynamic();try{await command([...args,'--go'],$('#dynamic-output'));}finally{checkedDynamic=null;}}).finally(()=>{button.disabled=true;});};
let editFile=null,checkedEdit=null;
function resetEdit(){checkedEdit=null;$('#edit-dynamic-save').disabled=true;}
for(const selector of ['#edit-dynamic-id','#edit-dynamic-text'])$(selector).addEventListener('input',()=>{if(selector==='#edit-dynamic-text')editFile=null;resetEdit();});
$('#choose-text').onclick=()=>action($('#choose-text'),async()=>{const epoch=panelEpoch;const paths=await window.pet.files.pick({kind:'file'});if(epoch!==panelEpoch)throw Error('宠物身份已切换，请重新选择文本文件。');if(!paths?.length)return;if(!/\.(txt|md)$/i.test(paths[0]))throw Error('请选择 TXT 或 Markdown 文本文件。');editFile=await call('importFile',{path:paths[0]});$('#edit-dynamic-text').value='';$('#chosen-text').textContent=editFile.name;resetEdit();});
async function editArgs(){const id=$('#edit-dynamic-id').value.trim();if(!/^[1-9]\d{0,29}$/.test(id))throw Error('请填写有效的动态 ID。');if(!editFile)editFile=await call('prepareText',{text:$('#edit-dynamic-text').value});return['dynamic-edit',id,editFile.path];}
$('#edit-dynamic-check').onclick=()=>action($('#edit-dynamic-check'),async()=>{resetEdit();const args=await editArgs();const result=await command(args,$('#edit-dynamic-output'));if(result.status==='completed'&&result.result?.exitCode===0){checkedEdit=JSON.stringify(args);$('#edit-dynamic-save').disabled=false;}});
$('#edit-dynamic-save').onclick=()=>{const button=$('#edit-dynamic-save');action(button,async()=>{const args=await editArgs();if(JSON.stringify(args)!==checkedEdit)throw Error('内容已变化，请重新检查修改。');resetEdit();try{await command([...args,'--go'],$('#edit-dynamic-output'));}finally{checkedEdit=null;}}).finally(()=>{button.disabled=true;});};
window.pet.events.on('host:context-changed',()=>{
  const epoch=++panelEpoch;dirty=false;settings=undefined;$('#settings-form').dataset.ready='false';loginId=null;$('#manual-cookie').value='';clearTimeout(loginTimer);dynamicImage=null;resetDynamic();editFile=null;resetEdit();
  watchTaskId=null;watchLoadedId=null;watchRunning=false;watchAccountKey=null;$('#watch-cancel').hidden=true;$('#watch-fallback').hidden=true;$('#watch-result').textContent='';$('#watch-status').textContent='正在切换宠物…';
  for(const selector of ['#dynamic-text','#edit-dynamic-id','#edit-dynamic-text','#target','#command-args'])$(selector).value='';$('#chosen-image').textContent='纯文字动态';$('#chosen-text').textContent='也可直接填写新正文';
  $('main').inert=true;$('#account-state').textContent='正在切换宠物…';$('#qr').hidden=true;
  for(const selector of ['#task-list','#draft-list','#diary-output','#operation-output','#operation-images','#logs'])$(selector).replaceChildren();
  (async()=>{for(let i=0;i<30&&!closed&&epoch===panelEpoch;i++){try{await refresh();if(epoch===panelEpoch){$('main').inert=false;notice('已切换到当前宠物的 B 站设置。');}return;}catch{await new Promise(resolve=>setTimeout(resolve,150));}}if(epoch===panelEpoch)notice('宠物身份正在切换，请稍后刷新面板。',true);})();
});
window.addEventListener('beforeunload',()=>{closed=true;clearTimeout(loginTimer);});
setInterval(()=>{if(!closed)refreshState().catch(()=>{});},5000);
(async()=>{for(let attempt=0;attempt<30&&!closed;attempt++){try{await refresh();return;}catch(error){if(attempt===29){notice(error.message,true);return;}await new Promise(resolve=>setTimeout(resolve,150));}}})();
