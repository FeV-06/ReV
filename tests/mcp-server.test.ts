import { describe, it, expect, vi } from 'vitest';
import { createRevMcpServer } from '../src/mcp/server';
import { resolveDaemonConfig, type DaemonApiClient } from '../src/mcp/client';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

describe('ReV MCP Server Tool Registration & Execution (Option A+)', () => {
  it('registers all 15 required role-based tools across Admin, Departing, and Successor suites', async () => {
    const mockClient = {
      request: vi.fn(),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    expect(server).toBeDefined();

    const tools = (server as any)._registeredTools;
    expect(tools).toBeDefined();

    const expectedTools = [
      // Admin Suite (6 original + 3 new lifecycle tools)
      'rev_admin_create_project',
      'rev_admin_get_available_sources',
      'rev_admin_configure_scope',
      'rev_admin_generate_handover',
      'rev_admin_approve_handover',
      'rev_admin_list_active_projects',
      'rev_admin_get_project_roster',
      'rev_admin_select_slack_channels',
      'rev_admin_get_bus_factor_risk',
      // Departing Suite (3 tools)
      'rev_departing_list_projects',
      'rev_departing_get_questions',
      'rev_departing_submit_answer',
      // Successor Suite (3 original + 2 new onboarding tools)
      'rev_successor_get_project_info',
      'rev_successor_download_artifacts',
      'rev_successor_raise_question',
      'rev_successor_update_checklist',
      'rev_successor_inspect_module',
    ];

    for (const toolName of expectedTools) {
      expect(tools[toolName], `Missing tool: ${toolName}`).toBeDefined();
    }
  });

  it('admin_get_available_sources returns mapped artifacts with selection status', async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        run: {
          id: 'test-run-123',
          selectedIds: ['art-1'],
          artifacts: [
            { id: 'art-1', kind: 'git_commit', sourceRef: 'commit 123', text: 'feat: add Redis cache', author: 'alice' },
            { id: 'art-2', kind: 'ast_symbol', sourceRef: 'core.ts:42', text: 'export function auth()', author: 'alice' },
          ],
        },
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_admin_get_available_sources'];

    const result = await tool.handler({ runId: 'test-run-123' });
    expect(result.content[0].text).toContain('test-run-123');
    expect(result.content[0].text).toContain('art-1');
    expect(result.content[0].text).toContain('art-2');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalArtifacts).toBe(2);
    expect(parsed.artifacts[0].isSelected).toBe(true);
    expect(parsed.artifacts[1].isSelected).toBe(false);
  });

  it('admin_configure_scope supports smart preset "non_cosmetic" using Laya triage', async () => {
    const mockClient = {
      request: vi.fn().mockImplementation((url: string, opts?: any) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({ run: { id: 'test-run-123', state: 'needs_review' } });
        }
        return Promise.resolve({
          run: {
            id: 'test-run-123',
            artifacts: [
              { id: 'art-arch', kind: 'git_commit', text: 'Decision: Selected Postgres for storage', paths: ['src/db.ts'] },
              { id: 'art-chore', kind: 'git_commit', text: 'chore: bump dependencies and lockfile', paths: ['pnpm-lock.yaml'] },
            ],
          },
        });
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_admin_configure_scope'];

    const result = await tool.handler({
      runId: 'test-run-123',
      preset: 'non_cosmetic',
      confirmAuthorisation: true,
    });

    expect(mockClient.request).toHaveBeenCalledWith(
      '/v1/runs/test-run-123/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'scope',
          selectedIds: ['art-arch'],
          confirmAuthorisation: true,
        }),
      })
    );
    expect(result.content[0].text).toContain('selectedCount": 1');
  });

  it('admin_generate_handover and admin_approve_handover advance run lifecycle', async () => {
    const mockClient = {
      request: vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === '/v1/runs/test-run-123' && !opts?.method) {
          return Promise.resolve({
            run: { id: 'test-run-123', selectedIds: ['art-1'], items: [], gaps: [] },
          });
        }
        if (url === '/v1/runs/test-run-123/actions' && opts?.method === 'POST') {
          const body = JSON.parse(opts.body);
          if (body.action === 'generate') {
            return Promise.resolve({
              run: {
                id: 'test-run-123',
                state: 'needs_review',
                items: [{ id: 'item-1', category: 'decision', text: 'Use Redis', verification: 'validated_reference' }],
                gaps: [{ id: 'gap-1', question: 'Why Redis?', status: 'open' }],
              },
            });
          }
          if (body.action === 'approve') {
            return Promise.resolve({
              run: { id: 'test-run-123', state: 'approved', approvedRevision: 1, items: [{ id: 'item-1' }] },
            });
          }
        }
        return Promise.resolve({});
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);

    // 1. Generate
    const genTool = (server as any)._registeredTools['rev_admin_generate_handover'];
    const genResult = await genTool.handler({ runId: 'test-run-123', confirmRemote: true });
    expect(genResult.content[0].text).toContain('generatedItemsCount": 1');
    expect(genResult.content[0].text).toContain('Use Redis');

    // 2. Approve
    const appTool = (server as any)._registeredTools['rev_admin_approve_handover'];
    const appResult = await appTool.handler({ runId: 'test-run-123', confirmAuthorisation: true });
    expect(appResult.content[0].text).toContain('approved');
    expect(appResult.content[0].text).toContain('approvedRevision": 1');
  });

  it('successor_update_checklist marks next_action item completed', async () => {
    const mockClient = {
      request: vi.fn().mockImplementation((url: string, opts?: any) => {
        if (opts?.method === 'POST') {
          const body = JSON.parse(opts.body);
          return Promise.resolve({ run: { id: 'test-run-123', items: body.items } });
        }
        return Promise.resolve({
          run: {
            id: 'test-run-123',
            items: [
              { id: 'item-1', category: 'next_action', text: 'Verify Redis failover', completed: false },
              { id: 'item-2', category: 'decision', text: 'Architecture notes' },
            ],
          },
        });
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_successor_update_checklist'];

    const result = await tool.handler({
      runId: 'test-run-123',
      taskId: 'item-1',
      completed: true,
      notes: 'Passed all cluster failover tests',
    });

    expect(result.content[0].text).toContain('completed": true');
    expect(mockClient.request).toHaveBeenCalledWith(
      '/v1/runs/test-run-123/actions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('successor_inspect_module returns targeted blame ownership and fragility scores', async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        revision: 'abc1234',
        modules: [
          {
            path: 'src/lib/server/store.ts',
            ownershipFraction: 0.85,
            departingLines: 120,
            totalLines: 140,
            score: 0.92,
            explanation: 'Departing author wrote 85% of store lines.',
          },
        ],
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_successor_inspect_module'];

    const result = await tool.handler({
      runId: 'test-run-123',
      modulePath: 'store.ts',
    });

    expect(result.content[0].text).toContain('src/lib/server/store.ts');
    expect(result.content[0].text).toContain('0.85');
    expect(result.content[0].text).toContain('0.92');
  });

  it('resolveDaemonConfig multi-path resolution discovers port and token from candidate directories', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-mcp-cfg-'));
    const oldRevDataDir = process.env.REV_DATA_DIR;
    try {
      await writeFile(path.join(tempDir, 'daemon.json'), JSON.stringify({ port: 3999, pid: 1234 }));
      await writeFile(path.join(tempDir, 'daemon.token'), 'test-daemon-token-xyz\n');

      process.env.REV_DATA_DIR = tempDir;
      const config = resolveDaemonConfig();

      expect(config.baseUrl).toBe('http://127.0.0.1:3999');
      expect(config.token).toBe('test-daemon-token-xyz');
    } finally {
      if (oldRevDataDir) process.env.REV_DATA_DIR = oldRevDataDir;
      else delete process.env.REV_DATA_DIR;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
