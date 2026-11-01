// One outbox for final user-facing results and fixed status summaries.
// Never forward intermediate transcripts, raw errors, credentials or private drafts.
export function createStatusNotices({pet,scope,check,getState,save}) {
  let tail=Promise.resolve()
  const active=new Set()
  const persist=async(state,revision)=>{try{await save(state)}catch{await check(revision)}}
  const send=async(entry,id,revision,state)=>{
    await check(revision)
    if(entry.status!=='pending')return entry.status
    try {
      if(typeof pet.pet?.notify==='function') {
        let accepted
        active.add(id)
        try{accepted=await pet.pet.notify({id,text:entry.text,scope})}finally{active.delete(id)}
        await check(revision)
        if(accepted&&entry.status==='pending'){
          entry.status='delivered'
          if(entry.taskId){const task=state.tasks.find(task=>task.id===entry.taskId);if(task)task.delivery='shared'}
          delete entry.text
        }
      } else if(!entry.taskId&&!entry.fallback) {
        entry.fallback=true
        await pet.pet?.bubble?.(entry.text)
        await check(revision)
        entry.status='bubble-only'
      }
    } catch { await check(revision) }
    await persist(state,revision)
    return entry.status
  }
  const queue=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result}
  // Cancellation bypasses the send queue: a chat tool must not wait behind
  // the message it is trying to cancel. The host does not retract committed rows.
  const cancel=async id=>{
    const state=getState(),entry=state.notices?.[id]
    if(!entry||entry.status!=='pending')return false
    entry.status='cancelled';delete entry.text
    const pending=typeof pet.pet?.notify==='function'?pet.pet.notify({id,scope,cancel:true}).catch(()=>false):Promise.resolve(false)
    try{await save(state)}catch{}
    return pending
  }
  return {
    cancel,
    // Lifecycle changes stop in-flight RPCs but retain completed, unsent
    // results for a later retry in this same account's outbox.
    cancelPending:()=>Promise.all([...active].map(id=>pet.pet.notify({id,scope,cancel:true}).catch(()=>false))),
    publish(id,text,revision,taskId) {
      return queue(async()=>{
        await check(revision)
        const state=getState();state.notices||={}
        const entry=state.notices[id]||={text,status:'pending',...(taskId?{taskId}:{})}
        // Persist before delivery so a transient SDK failure can be retried
        // without repeating the Bilibili action or requesting another model.
        await persist(state,revision)
        const result=await send(entry,id,revision,state)
        const completed=Object.keys(state.notices).filter(key=>state.notices[key].status!=='pending')
        for(const key of completed.slice(0,-100))delete state.notices[key]
        return result
      })
    },
    flush(revision) {
      return queue(async()=>{
        await check(revision)
        const state=getState()
        for(const [id,entry]of Object.entries(state.notices||{}).filter(([,item])=>item.status==='pending').slice(0,8))await send(entry,id,revision,state)
      })
    }
  }
}

export const taskLabel=task=>task.source==='watch'?'视频观看':({manual:'B 站任务',night:'B 站浏览',comment:'评论和 @ 消息处理',dm:'主人私信处理',live:'直播消息处理'}[task.kind]||'B 站任务')
