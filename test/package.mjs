import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

assert.ok(process.versions.bun,'Run this check with Bun');
const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
const archive=path.resolve(`${manifest.name}-${manifest.version}.tgz`);
assert.ok(fs.existsSync(archive),'Run bun pm pack first');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'humagent-package-'));
try {
  execFileSync('tar',['-xzf',archive,'-C',directory]);
  const root=path.join(directory,'package');
  const cli=path.join(root,'dist','cli.js');
  assert.equal(fs.existsSync(path.join(root,'node_modules')),false);
  assert.ok(fs.readFileSync(cli,'utf8').startsWith('#!/usr/bin/env bun\n'));
  const help=execFileSync(cli,['--help'],{cwd:root,encoding:'utf8',timeout:10000});
  assert.match(help,/Requires Bun/);
  assert.match(help,/humagent open/);
  console.log('PASS packaged CLI uses the Bun shebang without node_modules');
} finally {
  fs.rmSync(directory,{recursive:true,force:true});
}
