import { pathToFileURL } from 'node:url';

const [, , version, cli, home] = process.argv;
Object.defineProperty(process.versions, 'node', { value: version });
process.argv = [process.execPath, cli, 'status', '--home', home, '--json'];
await import(pathToFileURL(cli).href);
