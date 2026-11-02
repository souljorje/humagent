import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRuntime} from '../dist/server.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-browser-'));
fs.cpSync('examples',path.join(dir,'examples'),{recursive:true});fs.mkdirSync('.local',{recursive:true});
const runtime=await createRuntime({directory:path.join(dir,'state')});
const browser=await chromium.launch({headless:true,executablePath:process.env.HUMAGENT_BROWSER_PATH||undefined,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function api(route,method='GET',data){const response=await fetch(runtime.origin+route,{method,headers:{authorization:`Bearer ${runtime.token}`,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;}
async function open(target){const s=await api('/api/open','POST',{target});await page.goto(s.url);await page.waitForFunction(()=>document.getElementById('bridge-status').textContent==='Interface connected');return s;}
const frame=()=>page.frames().find(f=>f!==page.mainFrame());
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Condition did not become true');}
let app;
try{
  const planFile=path.join(dir,'examples/plan.html');const s=await open(planFile);
  await frame().locator('input[value="platform-first"]').check();
  await frame().locator('input[name="outcome"]').fill('A preserved human outcome.');
  await frame().locator('textarea[name="notes"]').fill('Keep this exact note.');
  await frame().locator('input[name="humanReview"]').uncheck();
  await until(()=>runtime.store.get(s.session).state.forms?.launch?.notes==='Keep this exact note.');
  await page.reload();await page.waitForFunction(()=>document.getElementById('bridge-status').textContent==='Interface connected');
  assert.equal(await frame().locator('input[name="outcome"]').inputValue(),'A preserved human outcome.');
  assert.equal(await frame().locator('input[value="platform-first"]').isChecked(),true);
  assert.equal(await frame().locator('input[name="humanReview"]').isChecked(),false);
  console.log('PASS persisted form state and workspace reload');

  const waiting=api(`/api/sessions/${s.session}/wait`,'POST',{consumer:'browser-test',timeoutMs:10000});
  await frame().locator('button[type="submit"]').click();const batch=await waiting;
  assert.equal(batch.status,'feedback');assert.equal(batch.events[0].kind,'submission');
  assert.deepEqual(batch.events[0].payload.values,{approach:'platform-first',outcome:'A preserved human outcome.',defer:'automation',notes:'Keep this exact note.',humanReview:false});
  await api(`/api/sessions/${s.session}/reply`,'POST',{receipt:batch.receipt,message:'Updated the plan using your choices. Nothing has been executed.'});
  await page.locator('.entry.agent').waitFor();assert.match(await page.locator('.entry.agent').textContent(),/Nothing has been executed/);
  console.log('PASS form → wait → receipt → agent reply → visible transcript');

  await frame().evaluate(async()=>window.humagent.submit({intent:'a_new_task_without_a_handler',values:{ranks:['b','a'],count:7}}));
  assert.equal(runtime.store.get(s.session).events.at(-1).payload.values.count,7);
  console.log('PASS arbitrary structured SDK submission without runtime changes');
  await page.locator('[data-mode="annotate"]').click();await frame().locator('h1').click();
  await page.locator('#message').fill('Keep the headline less prescriptive.');await page.locator('#send').click();
  await until(()=>runtime.store.get(s.session).events.some(e=>e.kind==='annotation'));
  assert.equal(runtime.store.get(s.session).events.at(-1).payload.target.id,'headline');
  await page.locator('[data-mode="edit"]').click();await frame().locator('[data-humagent-id="brief"]').click();
  await page.locator('#replacement').fill('My exact replacement.');await page.locator('#send').click();
  await until(()=>runtime.store.get(s.session).events.some(e=>e.kind==='edit'));
  assert.equal(runtime.store.get(s.session).events.at(-1).payload.after,'My exact replacement.');
  assert.ok(!fs.readFileSync(planFile,'utf8').includes('My exact replacement.'));
  console.log('PASS annotations and exact-edit proposals without source writes');

  await page.locator('[data-mode="annotate"]').click();
  await frame().evaluate(()=>{const node=document.querySelector('h1').firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,11);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.querySelector('h1').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#message').fill('Comment on these exact words.');await page.locator('#send').click();
  await until(()=>runtime.store.get(s.session).events.at(-1)?.payload?.target?.anchor);
  assert.equal(runtime.store.get(s.session).events.at(-1).payload.target.anchor.quote,'Start small');
  await page.locator('[data-mode="interact"]').click();
  await page.screenshot({path:'.local/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await frame().evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'.local/mobile.png',fullPage:true});
  console.log('PASS text-range anchoring and desktop/mobile layout');

  await page.setViewportSize({width:1440,height:1000});
  const calc=await open(path.join(dir,'examples/calculator.html'));
  await frame().locator('#tasks').evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await frame().locator('#hours').textContent(),'16.0 hours');
  assert.equal(runtime.store.get(calc.session).events.length,0);
  await frame().locator('button[type="submit"]').click();await until(()=>runtime.store.get(calc.session).events.length===1);
  console.log('PASS disposable mini-app behavior stays local until submitted');

  app=http.createServer((req,res)=>{if(req.url==='/api/value'){res.setHeader('content-type','application/json');res.end('{"value":42}');return;}
    const name=req.url==='/example.css'?'example.css':'existing.html';res.setHeader('content-type',name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(dir,'examples',name)));});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const existing=await open(`http://127.0.0.1:${app.address().port}/nested`);
  await frame().locator('#counter').click();assert.equal(await frame().locator('#counter').textContent(),'Count: 1');
  assert.deepEqual(await frame().evaluate(async()=>{return(await fetch('/api/value')).json();}),{value:42});
  await page.locator('[data-mode="annotate"]').click();await frame().locator('#headline').click();await page.locator('#message').fill('Review an existing app.');await page.locator('#send').click();
  await until(()=>runtime.store.get(existing.session).events.length===1);
  assert.equal(runtime.store.get(existing.session).events[0].payload.target.id,'headline');
  console.log('PASS existing localhost app, native click, API and review attachment');

  await page.locator('[data-mode="interact"]').click();
  const blocked=await frame().evaluate(async origin=>{try{const r=await fetch(origin+'/api/sessions',{headers:{'x-humagent-session':'guess'}});return r.status;}catch{return 'blocked';}},runtime.origin);
  assert.ok(blocked==='blocked'||blocked===403||blocked===401);
  assert.ok(!errors.length,JSON.stringify(errors));
  console.log('PASS isolated frame cannot access the workspace control plane');
  console.log('All browser checks passed. Screenshots: .local/desktop.png and .local/mobile.png');
}catch(e){await page.screenshot({path:'.local/failure.png',fullPage:true});console.error('Browser errors:',errors);throw e;}
finally{await browser.close();if(app){app.closeAllConnections();await new Promise(r=>app.close(r));}await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
