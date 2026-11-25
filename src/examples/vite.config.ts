/** The build of the demo. Agents edit its files, so they stay readable. */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: { alias: { '@': `${import.meta.dirname}/..` } },
  build: {
    minify: false,
    modulePreload: false,
    outDir: '../../dist/examples',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
