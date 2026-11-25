/** Workspace entry: connect the logic, the bar, and the plugins. */
import { createWorkspace } from './workspace/workspace.js';
import { createBar } from './bar/bar.js';
import { plugins } from '../plugins/index.js';

const id = new URL(location.href).searchParams.get('session') ?? '';
const workspace = createWorkspace(id, plugins);
await workspace.start(createBar(plugins, workspace.actions));
