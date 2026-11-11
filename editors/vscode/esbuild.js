const path = require('node:path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const extDir = __dirname;
const repoRoot = path.resolve(extDir, '..', '..');
const distDir = path.join(extDir, 'dist');
const sharedTeamPanel = path.join(repoRoot, 'src', 'components', 'team', 'TeamSyncPanel.tsx');

async function main() {
  const sharedPanelMissing = !require('node:fs').existsSync(sharedTeamPanel);
  if (sharedPanelMissing) {
    console.warn(
      `[rev-vscode] Shared team panel not found at ${sharedTeamPanel}; ` +
        'building with a stub webview entry. Re-run `pnpm vscode:build` once src/components/team lands.'
    );
  }

  const webviewEntry = sharedPanelMissing
    ? path.join(extDir, 'src/team/teamWebviewEntryStub.tsx')
    : path.join(extDir, 'src/team/teamWebviewEntry.tsx');

  // Node bundle: the extension host (unchanged behavior, now with team panel support).
  const hostCtx = await esbuild.context({
    entryPoints: [path.join(extDir, 'src/extension.ts')],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    platform: 'node',
    outfile: path.join(distDir, 'extension.cjs'),
    external: ['vscode'],
    logLevel: 'info',
  });

  // Browser bundle: shared React team panel + host-message bridge. Runs inside
  // the webview iframe; `vscode` is provided by the injected bridge, not bundled.
  const webviewCtx = await esbuild.context({
    entryPoints: [webviewEntry],
    bundle: true,
    format: 'iife',
    minify: false,
    sourcemap: false,
    platform: 'browser',
    outfile: path.join(distDir, 'teamWebview.js'),
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });

  const contexts = [hostCtx, webviewCtx];
  if (watch) {
    await Promise.all(contexts.map(c => c.watch()));
    console.log('Watching for changes...');
    return;
  }
  await Promise.all(contexts.map(c => c.rebuild()));
  await Promise.all(contexts.map(c => c.dispose()));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
