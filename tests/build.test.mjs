import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bili-package-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'node_modules'));fs.mkdirSync(path.join(root,'lib'))
  for(const name of ['index.cjs','LICENSE','NOTICE.md','README.md','UPSTREAM-README.md','scripts/build-ffmpeg.sh','lib/auth.js','lib/credential-values.js'])fs.writeFileSync(path.join(root,name),'fixture')
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'bili-build-fixture',version:'0.0.0',private:true}))
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({version:'0.0.0'}))
  fs.copyFileSync(new URL('../scripts/build-plugin.py',import.meta.url),path.join(root,'scripts/build-plugin.py'))
  return {root,run:(...args)=>spawnSync('python3',[path.join(root,'scripts/build-plugin.py'),...args],{encoding:'utf8',cwd:root})}
}
function bundle(root,over={}) {
  const dir=path.join(root,'bin','darwin-arm64');fs.mkdirSync(dir,{recursive:true})
  const source=Buffer.from('official source fixture'),binary=Buffer.from('binary fixture')
  for(const [name,value] of [['ffmpeg',binary],['LICENSE','LGPL fixture'],['version.txt','--disable-gpl --disable-nonfree'],['ffmpeg-source.tar.gz',source]])fs.writeFileSync(path.join(dir,name),value)
  const meta={sha256:createHash('sha256').update(binary).digest('hex'),sourceArchive:'ffmpeg-source.tar.gz',sourceSha256:createHash('sha256').update(source).digest('hex'),platform:'darwin-arm64',buildScript:'scripts/build-ffmpeg.sh',...over}
  fs.writeFileSync(path.join(dir,'SOURCE.json'),JSON.stringify(meta));return dir
}
test('builder produces a local candidate and includes the reproducible FFmpeg build script',t=>{
  const b=fixture(t);bundle(b.root)
  const result=b.run();assert.equal(result.status,0,result.stderr)
  assert.match(result.stdout,/local-candidate-unpublished/)
  const inspect=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))',path.join(b.root,'dist/bili-0.0.0.zip')],{encoding:'utf8'})
  assert.match(inspect.stdout,/scripts\/build-ffmpeg.sh/)
  assert.match(inspect.stdout,/UPSTREAM-README.md/)
  assert.match(inspect.stdout,/lib\/credential-values.js/)
  assert.ok(!inspect.stdout.includes('lib/credentials.js'))
})
test('builder rejects symlink assets, including directory ancestors and dependencies', {skip:process.platform==='win32'},t=>{
  const b=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'bili-external-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}))
  fs.writeFileSync(path.join(outside,'leak.txt'),'must not enter zip')
  fs.symlinkSync(outside,path.join(b.root,'src'),'dir')
  let result=b.run('--system-ffmpeg');assert.notEqual(result.status,0);assert.match(result.stderr,/Symlink/)
  fs.unlinkSync(path.join(b.root,'src'))
  fs.writeFileSync(path.join(outside,'package.json'),JSON.stringify({name:'external-dependency',version:'1.0.0'}))
  fs.writeFileSync(path.join(b.root,'package.json'),JSON.stringify({name:'fixture',version:'0.0.0',dependencies:{'external-dependency':'1.0.0'}}))
  fs.symlinkSync(outside,path.join(b.root,'node_modules','external-dependency'),'dir')
  result=b.run('--system-ffmpeg');assert.notEqual(result.status,0);assert.match(result.stderr,/Symlink|escapes/)
})
test('builder rejects binary/source digest mismatch and a nonfree configuration',t=>{
  const b=fixture(t),dir=bundle(b.root,{sha256:'0'.repeat(64)})
  let result=b.run();assert.notEqual(result.status,0);assert.match(result.stderr,/digest differs/)
  const meta=JSON.parse(fs.readFileSync(path.join(dir,'SOURCE.json'),'utf8'));meta.sha256=createHash('sha256').update(fs.readFileSync(path.join(dir,'ffmpeg'))).digest('hex');meta.sourceSha256='0'.repeat(64);fs.writeFileSync(path.join(dir,'SOURCE.json'),JSON.stringify(meta))
  result=b.run();assert.notEqual(result.status,0);assert.match(result.stderr,/source archive digest/)
  meta.sourceSha256=createHash('sha256').update(fs.readFileSync(path.join(dir,'ffmpeg-source.tar.gz'))).digest('hex');fs.writeFileSync(path.join(dir,'SOURCE.json'),JSON.stringify(meta));fs.writeFileSync(path.join(dir,'version.txt'),'--enable-nonfree')
  result=b.run();assert.notEqual(result.status,0);assert.match(result.stderr,/nonfree/)
})
