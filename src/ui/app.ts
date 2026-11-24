import { startWorkspace } from './workspace.js';
import { plugins } from '../plugins/index.js';

const id = new URL(location.href).searchParams.get('session') ?? '';
await startWorkspace(id, plugins);
