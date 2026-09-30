import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode artifact` builds a copy with every asset inlined so it can be
// published as a single-file preview page (see scripts/inline-artifact.ts).
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    root: 'web',
    base: './',
    plugins: [react()],
    build: {
      outDir: artifact ? '../dist/artifact-build' : '../dist/web',
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: artifact ? 50_000_000 : 4096,
    },
    server: { port: 5173, host: true },
  };
});
