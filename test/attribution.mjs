import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Read identifiers from the README, so checks do not repeat upstream names.
// Use the same check for the source tree and the extracted release archive.
export function assertReadmeAttribution(directory) {
  const root = path.resolve(directory);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const credits = readme.split('### Source credits\n')[1]?.split('\n### ')[0];
  assert.ok(credits, 'README source credits are missing');
  const entries = [...credits.matchAll(/^\| `([^`]+)` \| \[([^\]]+)\]\(https:\/\/github\.com\/([^/]+)\/([^/)]+)\) \| ([^|]+) \|$/gm)];
  assert.equal(entries.length, 2, 'Keep both adapted-helper credit entries');

  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim();
  const identifiers = new Set();
  for (const [, file, project, account, repository, author] of entries) {
    assert.ok(fs.existsSync(path.join(root, file)), `Missing credited helper: ${file}`);
    const notice = license.replace(/^Copyright[^\n]+$/m, `Copyright (c) 2026 ${author.trim()}`);
    assert.ok(readme.includes(notice), `Full MIT notice missing for ${file}`);
    for (const value of [project, account, repository, author.trim()]) identifiers.add(value);
  }

  const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const terms = [...identifiers].map(normalize);
  const ignored = new Set(['.git', '.local', 'node_modules']);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  function visit(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(current, entry.name);
      const relative = path.relative(root, file);
      if (relative === 'README.md') continue;
      assert.ok(!terms.some(term => normalize(relative).includes(term)), `Credit outside README.md: ${relative}`);
      if (entry.isDirectory()) {visit(file); continue;}
      if (!entry.isFile()) continue;
      let text;
      try {text = decoder.decode(fs.readFileSync(file));} catch {continue;}
      if (text.includes('\0')) continue;
      assert.ok(!terms.some(term => normalize(text).includes(term)), `Credit outside README.md: ${relative}`);
    }
  }
  visit(root);
  return [...identifiers];
}
