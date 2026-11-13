import { build } from 'esbuild';

await build({
  entryPoints: ['vendor-src/runtime.js'],
  outfile: 'vendor/runtime.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'inline',
  sourcemap: false,
});
