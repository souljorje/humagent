import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRuntime} from '../dist/server.js';
import {targetOf,safeFile} from '../dist/surfaces.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-http-'));
const root=path.join(dir,'artifacts');fs.mkdirSync(root);const file=path.join(root,'index.html');
fs.writeFileSync(file,'<!doctype html><html><body><h1>Hello</h1><script>const literal="</body>";</script></body></html>');
fs.writeFileSync(path.join(root,'app.js'),'window.works=true;');
let runtime;
test.before(async()=>{runtime=await createRuntime({directory:path.join(dir,'state')});});
test.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
async function api(route,method='GET',data,headers={}) {const res=await fetch(runtime.origin+route,{method,headers:{authorization:`Bearer ${runtime.token}`,'content-type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,data:await res.json()};}
async function opened(){const res=await api('/api/open','POST',{target:file});assert.equal(res.status,200);return res.data;}
test('opens isolated local surface and injects before literal body text',async()=>{const s=await opened();const snapshot=(await api(`/api/sessions/${s.session}`)).data;const page=await fetch(snapshot.surface.frameUrl);const html=await page.text();assert.match(html,/window.__HUMAGENT__/);assert.match(html,/const literal="<\/body>"/);assert.ok(snapshot.surface.origin!==runtime.origin);assert.ok(!html.includes(runtime.token));assert.ok(!html.includes(new URL(s.url).hash.slice(1)));assert.match(page.headers.get('content-security-policy'),/connect-src 'none'/);assert.match(await (await fetch(snapshot.surface.origin+'/app.js')).text(),/works=true/);});
test('session capability cannot invoke privileged operations or other sessions',async()=>{const s=await opened(),key=new URL(s.url).hash.slice(1);const headers={authorization:'','x-humagent-session':key};assert.equal((await api(`/api/sessions/${s.session}`,'GET',undefined,headers)).status,200);assert.equal((await api(`/api/sessions/${s.session}/wait`,'POST',{},headers)).status,401);assert.equal((await api('/api/open','POST',{target:file},headers)).status,401);});
test('rejects hostile origins, host headers, and missing credentials',async()=>{assert.equal((await api('/api/sessions','GET',undefined,{origin:'https://evil.example'})).status,403);assert.equal(await new Promise((resolve,reject)=>{const req=http.get(runtime.origin+'/api/sessions',{headers:{host:'evil.example',authorization:`Bearer ${runtime.token}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);}),403);assert.equal((await api('/api/sessions','GET',undefined,{authorization:''})).status,401);});
test('cannot run two writers against the same state directory',async()=>{await assert.rejects(()=>createRuntime({directory:path.join(dir,'state')}),/Another server/);});
test('remote, credential-bearing, HTTPS and unsupported file targets are refused',async()=>{for(const target of ['https://localhost:3000','http://example.com','http://user:secret@localhost:3000'])assert.equal((await api('/api/open','POST',{target})).status,400);await assert.rejects(()=>targetOf(path.join(root,'app.js')),/HTML/);});
test('file resolution denies hidden files, traversal and escaped symlinks',async()=>{fs.writeFileSync(path.join(root,'.secret'),'no');fs.writeFileSync(path.join(dir,'outside.txt'),'no');fs.symlinkSync(path.join(dir,'outside.txt'),path.join(root,'escape.txt'));await assert.rejects(()=>safeFile(root,'/.secret'));await assert.rejects(()=>safeFile(root,'/%2e%2e/outside.txt'));await assert.rejects(()=>safeFile(root,'/escape.txt'));});
test('wait receives an event once, reply acknowledges only that receipt',async()=>{const s=await opened();const before=(await api(`/api/sessions/${s.session}`)).data;
 const wait=api(`/api/sessions/${s.session}/wait`,'POST',{consumer:'test',timeoutMs:2000});await new Promise(r=>setTimeout(r,30));
 const e=await api(`/api/sessions/${s.session}/events`,'POST',{protocol:1,clientId:crypto.randomUUID(),revision:before.revision,kind:'submission',payload:{intent:'new_unregistered_intent',values:{x:1}}});assert.equal(e.status,200);
 const batch=await wait;assert.equal(batch.status,200);assert.equal(batch.data.status,'feedback');assert.equal(batch.data.events[0].payload.values.x,1);
 assert.equal((await api(`/api/sessions/${s.session}/reply`,'POST',{receipt:batch.data.receipt,message:'Updated'})).status,200);
 const after=(await api(`/api/sessions/${s.session}`)).data;assert.equal(after.events[0].status,'completed');assert.equal(after.replies[0].text,'Updated');
});
test('wait ownership, timeout and end are typed',async()=>{const s=await opened();const first=api(`/api/sessions/${s.session}/wait`,'POST',{consumer:'a',timeoutMs:2000});await new Promise(r=>setTimeout(r,20));assert.equal((await api(`/api/sessions/${s.session}/wait`,'POST',{consumer:'b',timeoutMs:20})).status,409);await api(`/api/sessions/${s.session}/end`,'POST',{});assert.equal((await first).data.status,'ended');const fresh=await opened();assert.equal((await api(`/api/sessions/${fresh.session}/wait`,'POST',{timeoutMs:10})).data.status,'timeout');});
test('source change rejects stale input without saving the file',async()=>{const s=await opened();const prior=(await api(`/api/sessions/${s.session}`)).data;fs.writeFileSync(file,'<!doctype html><h1>New version</h1>');const res=await api(`/api/sessions/${s.session}/events`,'POST',{protocol:1,clientId:crypto.randomUUID(),revision:prior.revision,kind:'edit',payload:{target:{selector:'h1'},before:'Hello',after:'Replace'}});assert.equal(res.status,409);assert.match(fs.readFileSync(file,'utf8'),/New version/);});
test('proxy preserves paths, JSON API and WebSocket upgrade; rejects external redirect',async()=>{
 const app=http.createServer((req,res)=>{if(req.url==='/api/value'){res.setHeader('content-type','application/json');res.end('{"value":42}');}else if(req.url==='/redirect'){res.writeHead(302,{location:'https://example.com'});res.end();}else{res.setHeader('content-type','text/html');res.end('<!doctype html><h1>Existing app</h1>');}});
 app.on('upgrade',(req,socket)=>{const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.end(Buffer.from([0x88,0x00]));});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));try{const target=`http://127.0.0.1:${app.address().port}/nested`;const s=(await api('/api/open','POST',{target})).data;const view=(await api(`/api/sessions/${s.session}`)).data;assert.match(await(await fetch(view.surface.frameUrl)).text(),/Existing app/);assert.deepEqual(await(await fetch(view.surface.origin+'/api/value')).json(),{value:42});assert.equal((await fetch(view.surface.origin+'/redirect',{redirect:'manual'})).status,502);
 await new Promise((resolve,reject)=>{const req=http.request(view.surface.origin+'/hmr',{headers:{connection:'Upgrade',upgrade:'websocket',origin:view.surface.origin,'sec-websocket-version':'13','sec-websocket-key':Buffer.alloc(16).toString('base64')}});req.on('upgrade',(res,socket)=>{assert.equal(res.statusCode,101);socket.destroy();resolve();});req.on('error',reject);req.end();});
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));}
});
