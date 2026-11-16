import { createRuntime } from '../../dist/runtime/server.js';

interface Command {
  id: number;
  action: 'listeners' | 'close';
}

const runtime = await createRuntime({ directory: process.argv[2] });
process.send!({
  type: 'ready',
  origin: runtime.origin,
  token: runtime.token,
  version: process.versions.node,
});
process.on('message', async (raw) => {
  const { id, action } = raw as Command;
  if (action === 'listeners') {
    process.send!({ id, value: runtime.store.listenerCount('change') });
  } else if (action === 'close') {
    await runtime.close();
    process.send!({ id, value: true }, () => process.disconnect!());
  }
});
