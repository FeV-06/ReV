import { build } from 'esbuild';
await build({entryPoints:['src/daemon/entry.ts'],outfile:'dist/daemon/entry.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',sourcemap:false});
