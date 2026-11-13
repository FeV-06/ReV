import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DaemonApiClient } from './client.js';
import { registerAdminTools } from './tools/admin.js';
import { registerDepartingTools } from './tools/departing.js';
import { registerSuccessorTools } from './tools/successor.js';

export function createRevMcpServer(client?: DaemonApiClient) {
  const server = new McpServer({
    name: 'rev-mcp-server',
    version: '0.1.0',
  });

  const apiClient = client || new DaemonApiClient();

  // Register all 3 role-based tool suites
  registerAdminTools(server, apiClient);
  registerDepartingTools(server, apiClient);
  registerSuccessorTools(server, apiClient);

  return server;
}
