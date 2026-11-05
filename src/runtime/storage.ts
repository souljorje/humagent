import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}
