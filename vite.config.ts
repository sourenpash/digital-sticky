import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode artifact` builds a copy with every asset inlined so it can be
// published as a single-file preview page (see scripts/inline-artifact.ts).
// That copy runs on sample data in the browser; the normal build talks to the
// board server (server/index.ts).
export default defineConfig(({ command, mode }) => {
  const artifact = mode === 'artifact';
  // Open screens compare this with the server's and reload after an update.
  const buildId = command === 'build' ? Date.now().toString(36) : 'dev';
  return {
    root: 'web',
    base: './',
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
      __DEMO_BUILD__: JSON.stringify(artifact),
    },
    plugins: [
      react(),
      {
        name: 'build-id',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'build.json', source: `${JSON.stringify({ buildId })}\n` });
        },
      },
    ],
    build: {
      outDir: artifact ? '../dist/artifact-build' : '../dist/web',
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: artifact ? 50_000_000 : 4096,
    },
    server: {
      port: 5173,
      host: true,
      // `npm run dev` runs the board server on 3000 next to this dev server.
      // xfwd marks proxied requests, so a phone using this dev server isn't mistaken for
      // the wall computer (which gets in without the PIN).
      proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } },
    },
  };
});
