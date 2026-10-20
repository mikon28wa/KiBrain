import { build } from 'esbuild';

// Background service worker runs as an ES module; content script and popup run
// as classic scripts (MV3 content scripts cannot be ES modules directly).
await build({
  entryPoints: ['extension/src/background.ts'],
  bundle: true,
  outfile: 'extension/background.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});

await build({
  entryPoints: ['extension/src/content.ts'],
  bundle: true,
  outfile: 'extension/content.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});

await build({
  entryPoints: ['extension/src/popup.ts'],
  bundle: true,
  outfile: 'extension/popup.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});
