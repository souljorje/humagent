import {test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertReadmeAttribution} from './attribution.mjs';
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
test('upstream names and full license notices stay only in the root README',()=>{
  assertReadmeAttribution(root);
});
test('attribution checks catch names in source, build output, and nested READMEs',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-attribution-'));
  try {
    for(const file of ['README.md','LICENSE','web/vendor/targets.js','web/vendor/anchors.js']) {
      const destination=path.join(directory,file);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.copyFileSync(path.join(root,file),destination);
    }
    const identifiers=assertReadmeAttribution(directory);
    for(const relative of ['source.js','dist/source.js','nested/README.md']) {
      const file=path.join(directory,relative);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      for(const identifier of identifiers) {
        fs.writeFileSync(file,identifier);
        assert.throws(()=>assertReadmeAttribution(directory),/Credit outside README/);
      }
      fs.rmSync(file);
    }
    const readme=path.join(directory,'README.md');
    fs.writeFileSync(readme,fs.readFileSync(readme,'utf8').replace('Permission is hereby granted','Notice removed'));
    assert.throws(()=>assertReadmeAttribution(directory),/Full MIT notice missing/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
