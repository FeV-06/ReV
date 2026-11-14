import esbuild from 'esbuild';
import { chmodSync } from 'node:fs';

async function build() {
  await esbuild.build({
    entryPoints: ['src/mcp/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: 'dist/mcp/index.js',
    packages: 'external',
  });

  try {
    chmodSync('dist/mcp/index.js', 0o755);
  } catch {}

  console.log('✓ ReV MCP server built successfully to dist/mcp/index.js');
}

build().catch((err) => {
  console.error('Failed to build ReV MCP server:', err);
  process.exit(1);
});
