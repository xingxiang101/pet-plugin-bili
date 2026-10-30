'use strict';
// Test-only transport adapter. Production plugin, engine, FFmpeg and Harness
// remain unchanged; every Bilibili read reaches the bounded loopback server.
const fs=require('node:fs'),path=require('node:path');
const base=process.env.PET_BILI_E2E_FIXTURE_BASE;
if(base){
  const target=new URL(base),profile=process.env.PET_USERDATA_DIR||'';
  if(process.env.PET_E2E_TEST!=='1'||target.hostname!=='127.0.0.1'||target.protocol!=='http:'||!path.basename(profile).startsWith('desktop-pet-bili-'))throw Error('Watch network fixture requires an isolated Bili E2E profile');
  // Seed only the test plugin process so the real 20s planner tick is repeatable.
  // Production code and wall clock stay unchanged.
  if(process.type==='utility')Math.random=()=>0;
  const nativeFetch=globalThis.fetch;
  if(typeof nativeFetch!=='function')throw Error('Watch network fixture requires native Node fetch');
  const audit=row=>fs.appendFileSync(process.env.PET_BILI_E2E_NETWORK_AUDIT,JSON.stringify({pid:process.pid,type:process.type||'node',...row})+'\n');
  audit({kind:'loaded'});
  const localRead=async(input,options)=>{
    const response=await nativeFetch(input,options);
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    const method=String(options.method||input.method||'GET').toUpperCase();
    if(url.hostname==='bilibili.com'||url.hostname.endsWith('.bilibili.com')){
      audit({kind:'bili',host:url.hostname,path:url.pathname,method});
      if(!['GET','HEAD'].includes(method))throw Error('Bili E2E forbids external writes');
      const local=new URL('/bili'+url.pathname+url.search,target);
      return localRead(local,options);
    }
    if(url.hostname==='upos-sz-mirrorcos.bilivideo.com'){
      audit({kind:'media',host:url.hostname,path:url.pathname,method});
      if(!['GET','HEAD'].includes(method))throw Error('Bili E2E forbids external writes');
      return localRead(new URL(url.pathname+url.search,target),options);
    }
    if(url.origin===target.origin)return nativeFetch(input,options);
    audit({kind:'blocked',host:url.hostname,path:url.pathname,method});
    throw Error('Bili E2E blocks non-fixture network');
  };
}
