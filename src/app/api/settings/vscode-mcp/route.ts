import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { requestDaemon } from '@/lib/server/daemon-client';
import { assertLocalRequest } from '@/lib/server/request-security';

export const runtime = 'nodejs';

const exec = promisify(execFile);
const loopback = /^(?:127\.0\.0\.1|localhost):3077$/;
const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const host = request.headers.get('host') ?? '';
    const forwardedHost = request.headers.get('x-forwarded-host') ?? host;
    if (!loopback.test(host) || !loopback.test(forwardedHost) || request.headers.get('origin') !== `http://${host}`) {
      throw new Error('Open ReV on localhost to set up VS Code MCP.');
    }
  } catch {
    return Response.json({ error: 'Open ReV on localhost to set up VS Code MCP.' }, { status: 403, headers: noStore });
  }

  try {
    const health = await requestDaemon('/v1/health');
    if (!health.ok) throw new Error('Daemon unavailable');
    if ((await health.json()).teamMode) {
      return Response.json({ error: 'VS Code MCP setup is available in local workspace mode.' }, { status: 409, headers: noStore });
    }
  } catch {
    return Response.json({ error: 'Start the local ReV daemon, then try again.' }, { status: 503, headers: noStore });
  }

  const root = process.cwd();
  try {
    await exec(process.execPath, ['scripts/build-mcp.mjs'], { cwd: root, timeout: 30_000, windowsHide: true });
  } catch {
    return Response.json({ error: 'ReV could not build its MCP server. Install the repo dependencies and try again.' }, { status: 500, headers: noStore });
  }

  const config = {
    type: 'stdio',
    command: process.execPath,
    args: [path.join(root, 'dist', 'mcp', 'index.js')],
    env: { REV_DATA_DIR: path.resolve(/* turbopackIgnore: true */ process.env.REV_DATA_DIR || '.rev-data') },
  };
  const prompt = 'Use the ReV MCP tool rev_admin_list_active_projects to list the handovers available in my local ReV workspace.';
  const query = `prompt=${encodeURIComponent(prompt)}&workspace=${encodeURIComponent(pathToFileURL(root).href)}`;
  return Response.json({
    installUrl: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'rev', ...config }))}`,
    chatUrl: `vscode://agents/new?${query}`,
    configuration: JSON.stringify({ mcpServers: { rev: config } }, null, 2),
  }, { headers: noStore });
}
