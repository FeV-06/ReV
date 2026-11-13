#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRevMcpServer } from './server.js';

async function main() {
  const server = createRevMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[ReV MCP] Stdio server connected and listening\n');
}

main().catch((err) => {
  process.stderr.write(`[ReV MCP Fatal Error] ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exit(1);
});
