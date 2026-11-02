import http, {type IncomingMessage, type ServerResponse} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {Store} from './store.js';
import {ensure, Failure, MAX_BYTES, object} from './protocol.js';
import {targetOf, sourceRevision, startSurface, type Surface} from './surfaces.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(data)); };
async function body(req: IncomingMessage) {
  ensure(req.headers['content-type']?.startsWith('application/json'), 'Expected application/json', 'CONTENT_TYPE', 415);
  let total = 0; const parts: Buffer[] = [];
  for await (const chunk of req) {total += chunk.length; ensure(total <= MAX_BYTES, 'Body exceeds 256 KiB', 'TOO_LARGE', 413); parts.push(chunk);}
  let value: unknown;
  try {value = JSON.parse(Buffer.concat(parts).toString('utf8'));} catch {throw new Failure(400,'INVALID_JSON','Malformed JSON');}
  object(value); return value;
}
export interface RuntimeOptions {directory: string; port?: number}
/** One runtime owns a directory. Files stay read-only; agents apply proposals. */
export async function createRuntime(options: RuntimeOptions) {
  const directory = path.resolve(options.directory); fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const lock = path.join(directory, 'server.lock');
  try {
    const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
  } catch {
    let alive = true; const pid = Number(fs.readFileSync(lock,'utf8'));
    if (Number.isInteger(pid) && pid > 0) {try {process.kill(pid,0);} catch (e) {alive = (e as NodeJS.ErrnoException).code !== 'ESRCH';}}
    ensure(!alive, 'Another server owns this state directory', 'SERVER_ACTIVE', 409);
    fs.unlinkSync(lock); const fd = fs.openSync(lock,'wx',0o600); fs.writeFileSync(fd,String(process.pid)); fs.closeSync(fd);
  }
  let store: Store;
  try {store = new Store(directory);} catch (error) {fs.unlinkSync(lock); throw error;}
  const token = randomBytes(32).toString('hex');
  const surfaces = new Map<string, Promise<Surface>>();
  const waiters = new Set<string>();
  const streams = new Set<ServerResponse>();
  const cancels = new Set<() => void>();
  let origin = '', closing = false;
  function surface(id: string) {
    store.get(id);
    if (!surfaces.has(id)) {const p = startSurface(store,id,origin).catch(e => {surfaces.delete(id); throw e;}); surfaces.set(id,p);}
    return surfaces.get(id)!;
  }
  function view(id: string) {
    const {viewKey: _key, lease, acknowledged: _ack, ...s} = store.get(id);
    return {...s, agent:lease && lease.expiresAt > Date.now() ? 'working' : waiters.has(id) ? 'waiting' : 'idle'};
  }
  async function snapshot(id: string) {
    const panel = await surface(id); await panel.refresh();
    return {...view(id), surface:{origin:panel.origin, frameUrl:panel.frameUrl, channel:panel.channel}};
  }
  const server = http.createServer(async (req,res) => {
    try {
      ensure(req.headers.host === new URL(origin).host, 'Invalid host', 'FORBIDDEN', 403);
      const from = req.headers.origin;
      ensure(!from || from === origin, 'Cross-origin control requests are forbidden', 'FORBIDDEN', 403);
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/health') return json(res,200,{app:'humagent',protocol:1,pid:process.pid});
      if (url.pathname === '/workspace' || ['/app.js','/app.css'].includes(url.pathname)) {
        ensure(req.method === 'GET', 'Method not allowed','METHOD',405);
        const name = url.pathname === '/workspace' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200, {'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8',
          'cache-control':'no-store','referrer-policy':'no-referrer', 'x-content-type-options':'nosniff',
          'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(fs.readFileSync(path.join(WEB,name)));
      }
      const control = equal(req.headers.authorization, `Bearer ${token}`);
      const match = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname);
      if (match) {
        const id = match[1]!, action = match[2] ?? '';
        const s = store.get(id);
        ensure(control || equal(req.headers['x-humagent-session'],s.viewKey), 'Unauthorized','UNAUTHORIZED',401);
        const agentOnly = ['wait','ack','reply','renew'].includes(action);
        ensure(!agentOnly || control, 'This operation requires the agent credential','UNAUTHORIZED',401);
        if (!action && req.method === 'GET') return json(res,200,await snapshot(id));
        if (action === 'events' && req.method === 'POST') {
          const value = await body(req); await (await surface(id)).refresh();
          return json(res,200,store.send(id,value));
        }
        if (action === 'state' && req.method === 'PUT') {
          const value = await body(req); store.saveState(id,value.expectedVersion,value.state); return json(res,200,view(id));
        }
        if (action === 'end' && req.method === 'POST') {await body(req); store.end(id); return json(res,200,view(id));}
        if (action === 'reply' && req.method === 'POST') {
          const value = await body(req);
          if (value.receipt !== undefined) store.acknowledge(id,value.receipt,value.message as string); else store.reply(id,value.message);
          return json(res,200,view(id));
        }
        if (action === 'ack' && req.method === 'POST') {const value=await body(req); store.acknowledge(id,value.receipt); return json(res,200,view(id));}
        if (action === 'renew' && req.method === 'POST') {const value=await body(req); store.renew(id,value.receipt,value.leaseMs as number|undefined); return json(res,200,{ok:true});}
        if (action === 'wait' && req.method === 'POST') {
          const value=await body(req); const timeout=Number(value.timeoutMs ?? 50000), leaseMs=Number(value.leaseMs ?? 120000);
          ensure(Number.isInteger(timeout) && timeout >= 1 && timeout <= 600000,'timeoutMs must be 1–600000');
          ensure(!waiters.has(id), 'Another agent is already waiting','LISTENER_ACTIVE',409);
          const take=()=>store.take(id,String(value.consumer ?? 'agent'),leaseMs);
          const immediate=take(); if(immediate) return json(res,200,immediate);
          waiters.add(id); store.emit('change',id);
          let done=false, processing=false;
          const cleanup=()=>{if(done)return;done=true;clearTimeout(timer);clearInterval(tick);store.off('change',changed);waiters.delete(id);cancels.delete(cancel);store.emit('change',id);};
          const cancel=()=>{cleanup();if(!res.writableEnded)json(res,200,{status:'interrupted'});};
          const changed=(session:string)=>{if(session!==id||done||processing)return;processing=true;try {const next=take();if(next){cleanup();json(res,200,next);}}catch(e){cleanup();fail(res,e);}finally{processing=false;}};
          const timer=setTimeout(()=>{cleanup();json(res,200,{status:'timeout'});},timeout);
          const tick=setInterval(()=>changed(id),500);
          store.on('change',changed); cancels.add(cancel);res.on('close',cleanup); return;
        }
        if (action === 'stream' && req.method === 'GET') {
          // fetch-based SSE allows the session capability in a header, not a URL.
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store',connection:'keep-alive'});
          res.write('event: ready\ndata: {}\n\n');streams.add(res);
          const changed=(key:string)=>{if(key===id&&!res.destroyed)res.write('event: change\ndata: {}\n\n');};
          store.on('change',changed);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
          res.on('close',()=>{clearInterval(heartbeat);store.off('change',changed);streams.delete(res);});return;
        }
        throw new Failure(404,'NOT_FOUND','Unknown session operation');
      }
      ensure(control, 'Unauthorized','UNAUTHORIZED',401);
      if(url.pathname==='/api/open'&&req.method==='POST') {
        const value=await body(req);ensure(typeof value.target==='string','target is required');
        const target=await targetOf(value.target,value.network===true);
        if(target.kind==='file'){const relative=path.relative(target.root!,directory);ensure(relative.startsWith('..')||path.isAbsolute(relative),'Use an artifact directory that does not contain Humagent private state','FORBIDDEN',403);}
        const revision=await sourceRevision(target);
        const s=store.open(target,revision);await surface(s.id);
        return json(res,200,{session:s.id,url:`${origin}/workspace?session=${s.id}#${s.viewKey}`,target:s.target,
          note:target.kind==='file'?`Only supported files in ${target.root} are served. Source is read-only.`:'Trusted local app proxy. Cookies/authenticated apps are not supported in v0.1.'});
      }
      if(url.pathname==='/api/stop'&&req.method==='POST'){await body(req);json(res,200,{stopped:true});setTimeout(()=>{void close();},25);return;}
      if(url.pathname==='/api/sessions'&&req.method==='GET')return json(res,200,{sessions:store.list().map(s=>view(s.id))});
      throw new Failure(404,'NOT_FOUND','Not found');
    }catch(error){fail(res,error);}
  });
  try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',resolve);});}
  catch(e){fs.unlinkSync(lock);throw e;}
  origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  fs.writeFileSync(path.join(directory,'server.json'),JSON.stringify({protocol:1,pid:process.pid,origin,token}),{mode:0o600});
  const close = async () => {if(closing)return;closing=true;for(const cancel of cancels)cancel();for(const stream of streams)stream.end();
      await Promise.all([...surfaces.values()].map(async p=>(await p).close()));
      server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
      for(const name of ['server.json','server.lock'])try{fs.unlinkSync(path.join(directory,name));}catch{}
    };
  return {origin,token,store,close};
}
function fail(res: ServerResponse, error: unknown) {
  if(res.headersSent){res.destroy();return;}
  const status=error instanceof Failure?error.status:400;
  json(res,status,{error:error instanceof Failure?error.code:'ERROR',message:error instanceof Error?error.message:'Request failed'});
}
