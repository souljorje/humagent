#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRuntime} from './server.js';
import {ensure} from './protocol.js';

const args=process.argv.slice(2);
const flags=new Map<string,string>();const positional:string[]=[];
for(let i=0;i<args.length;i++) {
  const value=args[i]!;
  if(value.startsWith('--')) {const split=value.indexOf('=');if(split>0)flags.set(value.slice(2,split),value.slice(split+1));
    else if(['no-open','network','help'].includes(value.slice(2)))flags.set(value.slice(2),'true');
    else {ensure(args[i+1]&&!args[i+1]!.startsWith('--'),`Missing value for ${value}`);flags.set(value.slice(2),args[++i]!);}}
  else positional.push(value);
}
const directory=path.resolve(flags.get('home')??process.env.HUMAGENT_HOME??path.join(os.homedir(),'.humagent'));
const HELP=`Humagent 0.1.0: visual collaboration with an existing agent

humagent open <file.html|http://localhost:port/path> [--no-open] [--network]
humagent wait <session> [--consumer name] [--timeout seconds] [--lease seconds]
humagent reply <session> --message "text" [--receipt id]
humagent ack <session> --receipt id
humagent renew <session> --receipt id [--lease seconds]
humagent status [session]
humagent end <session>
humagent server [--port number]
humagent stop
humagent setup [--directory path]

Requires Bun 1.4.4 or later.
--home directory / HUMAGENT_HOME selects private session storage.
Humagent does not write source files.
--network permits external requests and assets for trusted HTML files.
Keep wait attached to the current agent turn. It cannot resume an ended task.
`;
interface Record {protocol:number;pid:number;origin:string;token:string}
function record():Record|null {try{return JSON.parse(fs.readFileSync(path.join(directory,'server.json'),'utf8'));}catch{return null;}}
async function alive(r:Record|null) {
  if(!r||r.protocol!==1)return false;
  try{const res=await fetch(`${r.origin}/health`,{signal:AbortSignal.timeout(1000)});const info=await res.json() as {app?:string,pid?:number};return info.app==='humagent'&&info.pid===r.pid;}catch{return false;}
}
async function service() {
  const existing=record();if(await alive(existing))return existing!;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const log=fs.openSync(path.join(directory,'server.log'),'a',0o600);
  // process.execPath is Bun. The child must use the same runtime as the CLI.
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'server','--home',directory],{detached:true,stdio:['ignore',log,log],windowsHide:true});
  child.on('error',()=>{});child.unref();fs.closeSync(log);
  for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,100));const current=record();if(await alive(current))return current!;}
  throw new Error(`Could not start server. Inspect ${path.join(directory,'server.log')}`);
}
async function request(r:Record, route:string, method='GET', data?:unknown, timeout=65000) {
  const response=await fetch(r.origin+route,{method,headers:{authorization:`Bearer ${r.token}`,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(timeout)});
  const result=await response.json() as {message?:string,error?:string};
  if(!response.ok)throw new Error(`${result.error}: ${result.message}`);return result;
}
const output=(value:unknown)=>new Promise<void>(resolve=>process.stdout.write(JSON.stringify(value,null,2)+'\n',()=>resolve()));
function number(name:string, fallback:number) {const value=Number(flags.get(name)??fallback);ensure(Number.isFinite(value)&&value>0,`--${name} must be positive`);return value;}
async function main() {
  ensure(process.versions.bun, 'Humagent requires Bun. Run bun dist/cli.js instead of node dist/cli.js.');
  const [command,argument]=positional;
  if(!command||command==='help'||flags.has('help')){console.log(HELP);return;}
  if(command==='server') {
    const port=Number(flags.get('port')??process.env.HUMAGENT_PORT??4455);ensure(Number.isInteger(port)&&port>=0&&port<=65535,'Invalid port');
    const runtime=await createRuntime({directory,port});await output({status:'listening',origin:runtime.origin,runtime:'bun',runtimeVersion:process.versions.bun});
    for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void runtime.close().then(()=>process.exit(0));});return;
  }
  if(command==='setup') {
    const destination=path.resolve(flags.get('directory')??'.agents/skills/humagent');
    const file=path.join(destination,'SKILL.md');ensure(!fs.existsSync(file),'Skill already exists. Update it explicitly.');
    fs.mkdirSync(destination,{recursive:true});fs.copyFileSync(fileURLToPath(new URL('../skills/humagent/SKILL.md',import.meta.url)),file);
    await output({installed:file});return;
  }
  if(command==='stop'){const r=record();if(!await alive(r)){await output({stopped:true,alreadyStopped:true});return;}await output(await request(r!,'/api/stop','POST',{}));return;}
  const r=await service();
  if(command==='open') {
    ensure(argument,'Specify an HTML file or localhost URL');
    const target=/^https?:/i.test(argument)?argument:path.resolve(argument);
    const result=await request(r,'/api/open','POST',{target,network:flags.has('network')}) as {url?:string};
    if(!flags.has('no-open')&&result.url) {
      const [exe,parameters]=process.platform==='darwin'?['open',[result.url]]:process.platform==='win32'?['cmd',['/c','start','',result.url]]:['xdg-open',[result.url]];
      const child=spawn(exe as string,parameters as string[],{stdio:'ignore',detached:true,windowsHide:true});child.on('error',()=>{});child.unref();
    }
    await output(result);return;
  }
  if(command==='status'){await output(await request(r,argument?`/api/sessions/${argument}`:'/api/sessions'));return;}
  ensure(argument&&/^[\w-]+$/.test(argument),'Specify a valid session ID');
  const base=`/api/sessions/${argument}`;
  if(command==='wait') {
    const timeoutMs=number('timeout',50)*1000;
    process.stderr.write('Waiting for human input. Keep this tool invocation attached to the agent.\n');
    await output(await request(r,`${base}/wait`,'POST',{consumer:flags.get('consumer')??'agent',timeoutMs,leaseMs:number('lease',120)*1000},timeoutMs+5000));return;
  }
  if(command==='reply') {ensure(flags.has('message'),'--message is required');await output(await request(r,`${base}/reply`,'POST',{message:flags.get('message'),receipt:flags.get('receipt')}));return;}
  if(command==='ack'||command==='renew'){ensure(flags.has('receipt'),'--receipt is required');await output(await request(r,`${base}/${command}`,'POST',{receipt:flags.get('receipt'),leaseMs:number('lease',120)*1000}));return;}
  if(command==='end'){await output(await request(r,`${base}/end`,'POST',{}));return;}
  throw new Error(`Unknown command: ${command}`);
}
main().catch(async error=>{await output({error:error instanceof Error?error.message:String(error)});process.exitCode=1;});
