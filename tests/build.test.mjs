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
  fs.copyFileSync(new URL('../scripts/production-dependencies.cjs',import.meta.url),path.join(root,'scripts/production-dependencies.cjs'))
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
test('builder rejects unsupported manifest platforms before producing an install ZIP',t=>{
  const b=fixture(t);bundle(b.root)
  for(const platforms of [['win32-x64'],[],['darwin-arm64','darwin-arm64'],[null]]){
    fs.writeFileSync(path.join(b.root,'manifest.json'),JSON.stringify({version:'0.0.0',platforms}))
    const result=b.run();assert.notEqual(result.status,0);assert.match(result.stderr,/platforms/)
    assert.ok(!fs.existsSync(path.join(b.root,'dist/bili-0.0.0.zip')))
  }
  fs.writeFileSync(path.join(b.root,'manifest.json'),JSON.stringify({version:'0.0.0',platforms:['darwin-arm64']}))
  const result=b.run();assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).platforms,['darwin-arm64'])
})
test('builder includes the production library graph and licenses without unused CLI dynamic loaders',t=>{
  const b=fixture(t);bundle(b.root)
  const library=path.join(b.root,'node_modules','qr-fixture');fs.mkdirSync(library)
  fs.writeFileSync(path.join(b.root,'package.json'),JSON.stringify({name:'fixture',version:'0.0.0',dependencies:{'qr-fixture':'1.0.0'}}))
  fs.writeFileSync(path.join(library,'package.json'),JSON.stringify({name:'qr-fixture',version:'1.0.0',main:'index.js'}))
  fs.writeFileSync(path.join(library,'LICENSE'),'MIT fixture')
  fs.writeFileSync(path.join(library,'index.js'),"// require('./nonexistent')\nmodule.exports = require('./render')")
  fs.writeFileSync(path.join(library,'render.js'),'module.exports = 1')
  fs.writeFileSync(path.join(library,'unused-cli.js'),'module.exports = require(process.argv[2])')
  const result=b.run();assert.equal(result.status,0,result.stderr)
  const inspect=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))',path.join(b.root,'dist/bili-0.0.0.zip')],{encoding:'utf8'})
  assert.match(inspect.stdout,/qr-fixture\/render.js/)
  assert.match(inspect.stdout,/qr-fixture\/LICENSE/)
  assert.ok(!inspect.stdout.includes('unused-cli.js'))
  fs.writeFileSync(path.join(library,'render.js'),'module.exports = require(process.argv[2])')
  const rejected=b.run();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Dynamic require/)
})
test('builder checks all executable ZIP contents for forbidden loaders and evaluation',t=>{
  const b=fixture(t);bundle(b.root)
  fs.mkdirSync(path.join(b.root,'src'))
  for(const source of ['require(process.argv[2])','eval("1")','new Function("return 1")']){
    fs.writeFileSync(path.join(b.root,'src','unsafe.js'),source)
    const result=b.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Dynamic require|Forbidden code evaluation/)
  }
})
test('the packaged production dependency closure generates an actual QR PNG in isolation',t=>{
  const b=fixture(t),project=path.resolve(new URL('..',import.meta.url).pathname);bundle(b.root)
  const closure=spawnSync('node',[path.join(project,'scripts/production-dependencies.cjs')],{encoding:'utf8',cwd:project})
  assert.equal(closure.status,0,closure.stderr)
  for(const file of JSON.parse(closure.stdout)){
    const target=path.join(b.root,path.relative(project,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target)
  }
  fs.writeFileSync(path.join(b.root,'package.json'),JSON.stringify({name:'fixture',version:'0.0.0',dependencies:{qrcode:'1.5.4'}}))
  const built=b.run();assert.equal(built.status,0,built.stderr)
  const extracted=path.join(b.root,'installed')
  const unzip=spawnSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',path.join(b.root,'dist/bili-0.0.0.zip'),extracted],{encoding:'utf8'})
  assert.equal(unzip.status,0,unzip.stderr)
  const verify=spawnSync('node',['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import path from 'node:path';
    const root=process.argv[1],load=createRequire(path.join(root,'package.json'));
    const data=await load('qrcode').toDataURL('https://passport.bilibili.com/scan?key=fixture',{width:220,margin:2});
    assert.ok(data.startsWith('data:image/png;base64,'));
    const image=load('pngjs').PNG.sync.read(Buffer.from(data.split(',')[1],'base64'));
    assert.equal(image.width,220);assert.equal(image.height,220);
    assert.ok(image.data.some((value,index)=>index%4!==3&&value===0));
    assert.ok(image.data.some((value,index)=>index%4!==3&&value===255));
    assert.ok(load.resolve('qrcode').startsWith(root+path.sep));
  `,fs.realpathSync(extracted)],{encoding:'utf8',cwd:extracted,env:{...process.env,NODE_PATH:''}})
  assert.equal(verify.status,0,verify.stderr)
})
