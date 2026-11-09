const path = require('node:path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const extDir = __dirname;

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(extDir, 'src/extension.ts')],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    platform: 'node',
    outfile: path.join(extDir, 'dist/extension.cjs'),
    external: ['vscode'],
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
