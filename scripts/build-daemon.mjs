import { build } from 'esbuild';
await Promise.all([
  build({entryPoints:['src/daemon/entry.ts'],outfile:'dist/daemon/entry.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',sourcemap:false}),
  build({entryPoints:['src/daemon/autostart.ts'],outfile:'dist/daemon/autostart.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',sourcemap:false}),
]);
