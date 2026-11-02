import {test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dir,'..');
const cli=path.join(root,'dist/cli.js');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

test('CLI provides help and version without starting a server',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-help-'));
  try {
    const run=args=>execFileSync(process.execPath,[cli,...args,'--home',home],{encoding:'utf8'});
    assert.match(run(['-h']),/humagent demo/);
    assert.equal(run(['--version']).trim(),pkg.version);
    assert.equal(JSON.parse(run(['--version','--json'])).version,pkg.version);
    for(const args of [['unknown'],['open','--bad'],['reply','id','--message'],['wait','id','--timeout','0']]){
      assert.throws(()=>run(args));
      assert.equal(fs.existsSync(path.join(home,'server.json')),false);
    }
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
test('skill setup is repeatable and preserves edits',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-skill-'));
  try {
    const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'setup','--directory',directory,'--json',...args],{encoding:'utf8'}));
    run();assert.equal(run().unchanged,true);
    const file=path.join(directory,'SKILL.md');fs.appendFileSync(file,'\nCustom instruction.\n');
    assert.throws(()=>run());assert.match(fs.readFileSync(file,'utf8'),/Custom instruction/);
    run('--force');assert.ok(!fs.readFileSync(file,'utf8').includes('Custom instruction.'));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('package metadata has no installation build hooks',()=>{
  for(const hook of ['prepare','preinstall','install','postinstall'])assert.equal(pkg.scripts[hook],undefined);
  assert.equal(pkg.publishConfig.access,'public');
  assert.equal(pkg.bin.humagent,'dist/cli.js');
  assert.equal(pkg.packageManager,'bun@1.4.4');
});
test('project credits stay in README while legal notices remain',()=>{
  const banned=new RegExp(['good'+'[ -]?place','lav'+'ish','human'+'[- ]?review'].join('|'),'i');
  const skip=new Set(['.git','.local','node_modules','dist']);
  function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(skip.has(entry.name))continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())scan(file);
    else if(entry.name!=='README.md'&&/\.(md|ts|js|mjs|html|json|ya?ml)$/.test(entry.name))assert.ok(!banned.test(fs.readFileSync(file,'utf8')),file);
  }}
  scan(root);
  const notices=fs.readFileSync(path.join(root,'THIRD-PARTY-NOTICES.md'),'utf8');
  for(const author of ['Kun Chen','Peter Yang'])assert.ok(notices.includes(`Copyright (c) 2026 ${author}`));
  assert.equal((notices.match(/Permission is hereby granted/g)||[]).length,2);
});
