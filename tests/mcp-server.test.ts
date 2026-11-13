import { describe, it, expect, vi } from 'vitest';
import { createRevMcpServer } from '../src/mcp/server';
import type { DaemonApiClient } from '../src/mcp/client';

describe('ReV MCP Server Tool Registration & Execution', () => {
  it('registers all 10 required role-based tools across Admin, Departing, and Successor suites', async () => {
    const mockClient = {
      request: vi.fn(),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    expect(server).toBeDefined();

    // Verify registered tools
    const tools = (server as any)._registeredTools;
    expect(tools).toBeDefined();

    const expectedTools = [
      // Admin Suite
      'rev_admin_create_project',
      'rev_admin_configure_scope',
      'rev_admin_list_active_projects',
      'rev_admin_get_project_roster',
      // Departing Suite
      'rev_departing_list_projects',
      'rev_departing_get_questions',
      'rev_departing_submit_answer',
      // Successor Suite
      'rev_successor_get_project_info',
      'rev_successor_download_artifacts',
      'rev_successor_raise_question',
    ];

    for (const toolName of expectedTools) {
      expect(tools[toolName], `Missing tool: ${toolName}`).toBeDefined();
    }
  });

  it('admin_create_project forwards payload to daemon and returns summary', async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        run: { id: 'test-run-123', state: 'needs_scope' },
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_admin_create_project'];

    const result = await tool.handler({
      repo: 'FeV-06/ReV',
      departingPerson: 'Jordan Rivera',
      successorPerson: 'Alex Vance',
      targetRole: 'Lead Engineer',
    });

    expect(mockClient.request).toHaveBeenCalledWith(
      '/v1/runs',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(result.content[0].text).toContain('test-run-123');
    expect(result.content[0].text).toContain('Jordan Rivera');
  });

  it('successor_raise_question calls ask endpoint and reports citations or follow-up escalation', async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        answer: 'Redis was selected for sub-millisecond session lookup.',
        citations: [{ sourceId: 'src-1', quote: 'Decision: Redis' }],
        followUp: null,
      }),
    } as unknown as DaemonApiClient;

    const server = createRevMcpServer(mockClient);
    const tool = (server as any)._registeredTools['rev_successor_raise_question'];

    const result = await tool.handler({
      runId: 'test-run-123',
      question: 'Why Redis?',
      confirmRemote: true,
    });

    expect(mockClient.request).toHaveBeenCalledWith(
      '/v1/runs/test-run-123/ask',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(result.content[0].text).toContain('Decision: Redis');
  });
});
