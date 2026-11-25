/** The page SDK: the bridge to the workspace, and the plugins of this page document. */
import { pageInputs } from '@/plugins/inputs';
import { BOOTSTRAP_ID, type Bootstrap } from '@/shared/bridge';
import { createBridge, listenBridge } from './bridge';
import { attach, handlersOf, startHost } from './host';

function start() {
  const bootstrap = document.getElementById(BOOTSTRAP_ID)?.textContent;
  if (!bootstrap || window.parent === window)
    throw new Error('Humagent SDK requires an attached workspace');
  const boot: Bootstrap = JSON.parse(bootstrap);
  const bridge = createBridge(boot);
  const host = startHost(bridge, pageInputs);
  listenBridge(bridge, handlersOf(host));
  attach(host);
}

// A frame inside the page has no workspace of its own.
if (window.parent === window.top) start();
