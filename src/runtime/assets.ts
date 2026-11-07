import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Serve only shipped browser modules. Runtime code and package metadata stay private. */
export async function browserAsset(name: string, roots: readonly string[]) {
  const [root] = name.split('/');
  if (
    !roots.includes(root!) ||
    !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\.(?:js|css|html)$/.test(name)
  )
    return null;
  try {
    return await fs.readFile(
      fileURLToPath(new URL(`../${name}`, import.meta.url)),
    );
  } catch {
    return null;
  }
}
