import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const local = fileURLToPath(new URL('../.local/', import.meta.url));

export function fixture(name) {
  fs.mkdirSync(local, { recursive: true });
  return fs.mkdtempSync(path.join(local, `test-${name}-`));
}
