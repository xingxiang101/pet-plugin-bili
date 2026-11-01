// Only fixed, user-facing summaries belong here. Never forward model transcripts,
// network errors, credentials or private journal contents to the host notice.
export function createStatusNotices({pet,scope,check,getState,save}) {
  let tail=Promise.resolve()
  const persist=async(state,revision)=>{try{await save(state)}catch{await check(revision)}}
  const send=async(entry,id,revision,state)=>{
    await check(revision)
    if(entry.status==='delivered'||entry.status==='bubble-only')return entry.status
    try {
      if(typeof pet.pet?.notify==='function') {
        const accepted=await pet.pet.notify({id,text:entry.text,scope})
        await check(revision)
        if(accepted)entry.status='delivered'
      } else if(!entry.fallback) {
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
  return {
    publish(id,text,revision) {
      return queue(async()=>{
        await check(revision)
        const state=getState();state.notices||={}
        const entry=state.notices[id]||={text,status:'pending'}
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
