/** The build of the package, and the development server. */
import type { AddressInfo } from 'node:net';
import { dts } from 'rolldown-plugin-dts';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

interface Server {
  close(): Promise<void>;
}
const port = 4170;
const control = `http://127.0.0.1:${port}`;

/** Run Humagent from source, and open the example. */
async function start(vite: ViteDevServer): Promise<Server> {
  const address = vite.httpServer!.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const directory = '.local/dev';
  const { createServer } = await vite.ssrLoadModule('/server/server.ts');
  const { connect } = await vite.ssrLoadModule('/server/client.ts');
  const server = await createServer({
    directory,
    port,
    client: {
      workspace: `${origin}/ui/`,
      sdk: { script: `${origin}/sdk/sdk.ts`, styles: [] },
    },
  });
  const client = await connect(directory);
  const { url } = await client.open(`${origin}/examples/`, false);
  vite.config.logger.info(`  ➜  Workspace: ${url}`);
  return server;
}

/** Humagent runs while Vite runs. A change in its modules restarts both. */
function humagent(): Plugin {
  let running: Promise<Server | void> | undefined;
  return {
    name: 'humagent',
    apply: 'serve',
    configureServer(vite) {
      vite.httpServer!.once('listening', () => {
        // Another restart can interrupt a start.
        running = start(vite).catch((error) =>
          vite.config.logger.error(String(error)),
        );
      });
    },
    async hotUpdate({ modules, server: vite }) {
      if (this.environment.name === 'ssr' && modules.length)
        await vite.restart();
    },
    async buildEnd() {
      const server = await running;
      await server?.close();
    },
  };
}

export default defineConfig(({ command }) => ({
  root: 'src',
  base: command === 'build' ? '/__humagent/' : '/',
  resolve: { alias: { '@': `${import.meta.dirname}/src` } },
  plugins: [humagent()],
  builder: {},
  // The declaration plugin needs its own files.
  oxc: { exclude: [/\.js$/, /\.d\.ts$/] },
  build: { minify: false, emptyOutDir: true },
  environments: {
    client: {
      build: {
        outDir: '../dist/client',
        manifest: true,
        rolldownOptions: {
          // Browser tests supply an extra picker through the page input module.
          input: ['/ui/index.html', '/sdk/sdk.ts', '/plugins/inputs.ts'],
          output: { minifyInternalExports: false },
        },
      },
    },
    ssr: {
      build: {
        outDir: '../dist/node',
        rolldownOptions: {
          input: {
            cli: '/cli/index.ts',
            server: '/server/server.ts',
            feedback: '/shared/feedback.ts',
          },
          plugins: [dts({ generator: 'tsrs' })],
          // The public entries export only what their source exports.
          preserveEntrySignatures: 'strict',
          // A chunk stays beside the entries, because it finds files relative to itself.
          output: { chunkFileNames: '[name]-[hash].js' },
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: control,
        changeOrigin: true,
        headers: { origin: control },
      },
    },
  },
}));
