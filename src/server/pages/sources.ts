/** What the human gives feedback on: an HTML file or a localhost app. */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Source } from '../../shared/feedback.js';
import { ensure } from '../../shared/validate.js';
import { localUrl } from '../validate.js';
import { digest } from './documents.js';
import { fetchDocument } from './upstream.js';

export async function sourceOf(
  value: string,
  network = false,
): Promise<Source> {
  if (/^https?:/i.test(value)) {
    const url = new URL(value);
    ensure(
      localUrl(url),
      'Only explicit HTTP localhost/127.0.0.1 sources are supported',
    );
    url.hostname = '127.0.0.1';
    url.hash = '';
    return { kind: 'url', value: url.href, network: true };
  }
  const canonical = await fs.realpath(path.resolve(value));
  ensure(
    /\.html?$/i.test(canonical),
    'Humagent opens HTML files or localhost apps. Markdown rendering is not implemented.',
  );
  return {
    kind: 'file',
    value: canonical,
    root: path.dirname(canonical),
    network,
  };
}
export async function sourceRevision(source: Source) {
  return digest(
    source.kind === 'file'
      ? await fs.readFile(source.value)
      : await fetchDocument(new URL(source.value)),
  );
}
