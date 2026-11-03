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
  const entries = [
    ...credits.matchAll(
      /^\| `([^`]+)` \| \[source\]\(https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([a-f0-9]{40})\/[^)]+\) \| \[notice\]\(#third-party-notices\) \|$/gm,
    ),
  ];
  assert.equal(entries.length, 2, 'Keep both adapted-helper credit entries');

  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim();
  const identifiers = new Set();
  const inspiration = readme.match(/^Humagent is inspired by (.+)\.$/m)?.[1];
  assert.ok(inspiration, 'README inspiration is missing');
  const projects = [
    ...inspiration.matchAll(
      /\[([^\]]+)\]\(https:\/\/github\.com\/([^/]+)\/([^/)]+)\)/g,
    ),
  ];
  assert.equal(projects.length, entries.length);
  const authors = [...readme.matchAll(/^Copyright \(c\) 2026 (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(authors.length, entries.length);
  for (const [
    index,
    [, file, account, repository, revision],
  ] of entries.entries()) {
    assert.ok(
      fs.existsSync(path.join(root, file)),
      `Missing credited helper: ${file}`,
    );
    assert.ok(
      fs
        .readFileSync(path.join(root, file), 'utf8')
        .includes('README.md#third-party-notices'),
      `Missing notice link for ${file}`,
    );
    const project = projects.find(
      ([, , owner, repo]) => owner === account && repo === repository,
    );
    assert.ok(project, `Missing inspiration link for ${file}`);
    const author = authors[index];
    const notice = license.replace(
      /^Copyright[^\n]+$/m,
      `Copyright (c) 2026 ${author}`,
    );
    assert.ok(readme.includes(notice), `Full MIT notice missing for ${file}`);
    for (const value of [project[1], account, repository, author, revision])
      identifiers.add(value);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort();
  const runtimeCredits = readme
    .split('### Runtime dependencies\n')[1]
    ?.split('\n### ')[0];
  assert.ok(runtimeCredits, 'README runtime credits are missing');
  const runtimeEntries = [
    ...runtimeCredits.matchAll(
      /^\| `([^`]+)` \| \[source\]\((https:\/\/github\.com\/[^)]+)\) \| \[notice\]\(#third-party-notices\) \|$/gm,
    ),
  ];
  assert.deepEqual(
    runtimeEntries.map((entry) => entry[1]).sort(),
    dependencies,
    'Credit every runtime dependency',
  );
  for (const [, name, source] of runtimeEntries) {
    const summary = `<summary><code>${name}</code>: copyright and MIT license</summary>`;
    const notice = readme
      .split(summary)[1]
      ?.split('</details>')[0]
      ?.split('```text\n')[1]
      ?.split('\n```')[0];
    assert.ok(notice, `Full MIT notice missing for ${name}`);
    const copyright = notice.match(/^Copyright[^\n]+$/m)?.[0];
    assert.ok(copyright, `Copyright missing for ${name}`);
    assert.equal(
      notice,
      license.replace(/^Copyright[^\n]+$/m, copyright),
      `Full MIT notice missing for ${name}`,
    );
    const installedLicense = path.join(root, 'node_modules', name, 'LICENSE');
    if (fs.existsSync(installedLicense))
      assert.equal(notice, fs.readFileSync(installedLicense, 'utf8').trim());
    identifiers.add(source);
    identifiers.add(copyright);
    const author = copyright.match(/,\s*(.+?)\s+and\s+/)?.[1];
    if (author) identifiers.add(author);
  }

  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const terms = [...identifiers].map(normalize);
  const ignored = new Set(['.git', '.local', 'node_modules']);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(current, entry.name);
      const relative = path.relative(root, file);
      if (relative === 'README.md') continue;
      assert.ok(
        !terms.some((term) => normalize(relative).includes(term)),
        `Credit outside README.md: ${relative}`,
      );
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.isFile()) continue;
      let text;
      try {
        text = decoder.decode(fs.readFileSync(file));
      } catch {
        continue;
      }
      if (text.includes('\0')) continue;
      assert.ok(
        !terms.some((term) => normalize(text).includes(term)),
        `Credit outside README.md: ${relative}`,
      );
    }
  }
  visit(root);
  return [...identifiers];
}
