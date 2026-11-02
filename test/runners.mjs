import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const archive=path.resolve(`${pkg.name}-${pkg.version}.tgz`);
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-runners-'));
const env={...process.env,HUMAGENT_HOME:path.join(cwd,'state'),HUMAGENT_PORT:'0'};
const run=async(command,args)=>(await exec(command,args,{cwd,env,encoding:'utf8',timeout:60000})).stdout;
try {
  fs.writeFileSync(path.join(cwd,'package.json'),'{"name":"runner-fixture","private":true}');
  await run('npm',['install','--offline','--no-audit','--no-fund',archive]);
  assert.equal(JSON.parse(await run('bunx',['--bun','--no-install','humagent','doctor','--json'])).runtime,'bun');
  const opened=JSON.parse(await run('bunx',['--bun','--no-install','humagent','demo','--no-open','--json']));
  assert.ok(opened.session);
  await run('bunx',['--bun','--no-install','humagent','stop','--json']);
  assert.equal((await run('pnpm',['--package',archive,'dlx','humagent','--version'])).trim(),pkg.version);
  // A fresh npm cache proves that npx can install and execute the archive.
  const fresh={...env,npm_config_cache:path.join(cwd,'fresh-cache')};
  const installed=await exec('npx',['--yes','--offline',`--package=${archive}`,'humagent','--version'],{cwd,env:fresh,encoding:'utf8',timeout:60000});
  assert.equal(installed.stdout.trim(),pkg.version);
  console.log('PASS bunx --bun, pnpm dlx, and fresh-cache npx execute the release archive');
} finally {
  try {await run('bunx',['--bun','--no-install','humagent','stop','--json']);} catch {}
  for(let i=0;i<100&&fs.existsSync(path.join(env.HUMAGENT_HOME,'server.lock'));i++)await new Promise(r=>setTimeout(r,20));
  fs.rmSync(cwd,{recursive:true,force:true});
}
