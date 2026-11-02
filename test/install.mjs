/** Test the archive as an npm user. No registry publication is performed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const archive=path.resolve(`${pkg.name}-${pkg.version}.tgz`);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-install-'));
const home=path.join(temporary,'state');
// Remove the normal Bun directory. npm execution must not require Bun.
const env={...process.env,HUMAGENT_HOME:home,HUMAGENT_PORT:'0',npm_config_cache:path.join(temporary,'cache'),npm_config_update_notifier:'false'};
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';
env[pathKey]=(env[pathKey]||'').split(path.delimiter).filter(item=>!/[\\/]\.bun[\\/]/i.test(item)).join(path.delimiter);
const npm=process.platform==='win32'?'npm.cmd':'npm';
const npmRun=async args=>(await execute(npm,args,{cwd:temporary,env,encoding:'utf8',timeout:90000,shell:process.platform==='win32'})).stdout;
const run=async(...args)=>JSON.parse(await npmRun(['exec','--offline','--','humagent',...args,'--json']));
let app;
try {
  fs.writeFileSync(path.join(temporary,'package.json'),'{"name":"install-fixture","private":true}');
  await npmRun(['install','--offline','--no-audit','--no-fund',archive]);
  const installed=path.join(temporary,'node_modules','humagent');
  assert.equal(fs.existsSync(path.join(installed,'node_modules')),false);
  assert.equal(fs.existsSync(path.join(installed,'src')),false);
  assert.equal((await run('--version')).version,pkg.version);
  assert.equal((await run('doctor')).runtime,'node');
  assert.equal((await run('doctor')).filesPresent,true);
  const opened=await run('demo','plan','--no-open');
  const snapshot=await run('status',opened.session);
  assert.equal(fs.existsSync(snapshot.target.value),true);
  const record=JSON.parse(fs.readFileSync(path.join(home,'server.json'),'utf8'));
  const startup=JSON.parse(fs.readFileSync(path.join(home,'server.log'),'utf8').trim());
  assert.equal(startup.runtime,'node');
  const shell=await fetch(opened.url.split('#')[0]);assert.equal(shell.status,200);assert.match(await shell.text(),/Humagent/);
  const surface=await fetch(snapshot.surface.frameUrl);assert.equal(surface.status,200);assert.match(await surface.text(),/data-humagent-intent/);
  const waiting=run('wait',opened.session,'--timeout','10','--lease','60');
  const response=await fetch(`${record.origin}/api/sessions/${opened.session}/events`,{method:'POST',headers:{'content-type':'application/json','x-humagent-session':new URL(opened.url).hash.slice(1)},body:JSON.stringify({protocol:1,clientId:'installed-test',revision:snapshot.revision,kind:'submission',payload:{intent:'revise_plan',values:{approach:'pilot-first'}}})});
  assert.equal(response.status,200);
  const batch=await waiting;
  assert.equal(batch.events[0].payload.values.approach,'pilot-first');
  await run('reply',opened.session,'--receipt',batch.receipt,'--message','Updated.');
  assert.equal((await run('status',opened.session)).events[0].status,'completed');
  await run('setup');assert.equal((await run('setup')).unchanged,true);
  app=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Installed package proxy</h1>');});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const attached=await run('open',`http://127.0.0.1:${app.address().port}`,'--no-open');
  const appState=await run('status',attached.session);
  assert.match(await(await fetch(appState.surface.frameUrl)).text(),/Installed package proxy/);
  await run('end',opened.session);
  assert.equal((await run('wait',opened.session,'--timeout','1')).status,'ended');
  console.log('PASS npm install from tarball and npm exec: demo, server, source, structured input, reply, skill, local proxy');
  // npx delegates to npm exec. Exercise its actual binary as well.
  const npx=process.platform==='win32'?'npx.cmd':'npx';
  const npxResult=await execute(npx,['--offline','humagent','--version'],{cwd:temporary,env,encoding:'utf8',timeout:20000,shell:process.platform==='win32'});
  assert.equal(npxResult.stdout.trim(),pkg.version);
  console.log('PASS npx executes the installed tarball with Node.js');
} finally {
  try {await run('stop');} catch {}
  for(let n=0;n<150&&fs.existsSync(path.join(home,'server.lock'));n++)await new Promise(r=>setTimeout(r,20));
  if(app){app.closeAllConnections();await new Promise(r=>app.close(r));}
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
