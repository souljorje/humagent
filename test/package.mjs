import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {assertReadmeAttribution} from './attribution.mjs';

const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
const archive=path.resolve(`${manifest.name}-${manifest.version}.tgz`);
assert.ok(fs.existsSync(archive),'Run bun pm pack first');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-package-'));
try {
  execFileSync('tar',['-xzf',archive,'-C',directory]);
  const root=path.join(directory,'package');
  const cli=path.join(root,'dist','cli.js');
  const packaged=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(fs.existsSync(path.join(root,'node_modules')),false);
  assert.equal(fs.existsSync(path.join(root,'src')),false);
  assert.equal(fs.existsSync(path.join(root,'.github')),false);
  assert.equal(fs.existsSync(path.join(root,'.local')),false);
  for(const script of ['prepare','preinstall','install','postinstall'])assert.equal(packaged.scripts?.[script],undefined,`Unexpected install hook: ${script}`);
  assert.deepEqual(packaged.dependencies??{},{});
  for(const file of ['web/index.html','web/sdk.js','examples/plan.html','skills/humagent/SKILL.md','docs/CLI.md','LICENSE','README.md'])assert.ok(fs.existsSync(path.join(root,file)),file);
  assertReadmeAttribution(root);
  assert.ok(fs.readFileSync(cli,'utf8').startsWith('#!/usr/bin/env node\n'));
  const help=execFileSync(process.execPath,[cli,'--help'],{cwd:directory,encoding:'utf8',timeout:10000});
  assert.match(help,/humagent demo/);
  assert.match(help,/Node.js 22/);
  assert.equal(execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),manifest.version);
  console.log(`PASS compiled package runs with ${process.versions.bun?'Bun':'Node.js'} without development dependencies`);
} finally {fs.rmSync(directory,{recursive:true,force:true});}
