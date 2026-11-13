import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Read a shipped browser module, such as `/ui/app.js`. Callers validate the path, so runtime code and package metadata stay private. */
export async function browserAsset(pathname: string) {
  try {
    return await fs.readFile(
      fileURLToPath(new URL(`..${pathname}`, import.meta.url)),
    );
  } catch {
    return null;
  }
}
