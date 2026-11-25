/** Workspace entry: connect the logic, the bar, and the plugins. */
import { createWorkspace } from './workspace/workspace';
import { createBar } from './bar/bar';
import { plugins } from '@/plugins';

const id = new URL(location.href).searchParams.get('session') ?? '';
const workspace = createWorkspace(id, plugins);
await workspace.start(createBar(plugins, workspace.actions));
