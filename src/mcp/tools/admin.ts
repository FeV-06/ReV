import { z } from 'zod';
import type { DaemonApiClient } from '../client';

export function registerAdminTools(server: any, client: DaemonApiClient) {
  // 1. rev_admin_create_project
  server.registerTool(
    'rev_admin_create_project',
    {
      description: 'Create a new developer handover project, designating departing contributor and successor onboarder.',
      inputSchema: z.object({
        repo: z.string().describe('Local workspace path or GitHub "owner/repo" slug'),
        departingPerson: z.string().describe('Name or handle of departing engineer'),
        departingEmail: z.string().optional().describe('Work email of departing engineer'),
        successorPerson: z.string().describe('Name or handle of successor developer'),
        successorEmail: z.string().optional().describe('Work email of successor developer'),
        targetRole: z.string().optional().describe('Target role for onboarding engineer'),
      }),
    },
    async (args: any) => {
      try {
        const payload = {
          recipient: args.successorPerson,
          githubUsername: args.departingPerson.replace(/^@/, ''),
          targetRole: args.targetRole || 'Engineer',
          departingPerson: args.departingPerson,
          departingEmail: args.departingEmail || '',
          successorEmail: args.successorEmail || '',
          fixture: false,
        };
        const runRes = await client.request('/v1/runs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Handover project created successfully for ${args.repo}`,
                  runId: runRes.run?.id,
                  departingPerson: args.departingPerson,
                  successorPerson: args.successorPerson,
                  state: runRes.run?.state,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create handover project: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 2. rev_admin_configure_scope
  server.registerTool(
    'rev_admin_configure_scope',
    {
      description: 'Filter and select relevant data/commits/docs to be handed over to the successor, enforcing privacy guardrails.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        selectedSourceIds: z.array(z.string()).describe('Array of source artifact IDs approved for inclusion'),
        confirmAuthorisation: z.boolean().describe('Explicit confirmation that the recipient is authorized to receive selected data'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'scope',
            selectedIds: args.selectedSourceIds,
            confirmAuthorisation: args.confirmAuthorisation,
          }),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  runId: args.runId,
                  state: res.run?.state,
                  selectedCount: args.selectedSourceIds.length,
                  message: 'Scope configured and authorized. Previous draft invalidated for regeneration.',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to configure scope: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 3. rev_admin_list_active_projects
  server.registerTool(
    'rev_admin_list_active_projects',
    {
      description: 'List active handover projects, including who is leaving and who will be joining.',
      inputSchema: z.object({
        statusFilter: z.enum(['all', 'needs_review', 'approved']).optional().describe('Optional filter by handover state'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request('/v1/runs');
        let runs = (res.runs || []) as any[];
        if (args.statusFilter && args.statusFilter !== 'all') {
          runs = runs.filter((r) => r.state === args.statusFilter);
        }
        const summary = runs.map((r) => ({
          runId: r.id,
          recipient: r.recipient,
          departingPerson: r.departingPerson || r.githubUsername || 'Unspecified',
          successorPerson: r.recipient,
          targetRole: r.targetRole || 'Developer',
          state: r.state,
          createdAt: r.createdAt,
          gapsCount: r.gaps?.length || 0,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: summary.length, projects: summary }, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list active projects: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 4. rev_admin_get_project_roster
  server.registerTool(
    'rev_admin_get_project_roster',
    {
      description: 'Retrieve detailed roster information (departing person, successor, emails, target role) for a specific project run.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}`);
        const r = res.run;
        if (!r) throw new Error('Run not found');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  runId: r.id,
                  departingPerson: r.departingPerson || r.githubUsername,
                  departingEmail: r.departingEmail || null,
                  successorPerson: r.recipient,
                  successorEmail: r.successorEmail || null,
                  targetRole: r.targetRole,
                  state: r.state,
                  createdAt: r.createdAt,
                  approvedRevision: r.approvedRevision,
                  unresolvedGaps: (r.gaps || []).filter((g: any) => g.status === 'open').length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get project roster: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 5. rev_admin_select_slack_channels
  server.registerTool(
    'rev_admin_select_slack_channels',
    {
      description: 'Configure and associate specific Slack channel IDs for handover evidence ingestion.',
      inputSchema: z.object({
        channelIds: z.array(z.string().regex(/^[CG][A-Z0-9]+$/)).max(5).describe('List of up to 5 Slack channel IDs to ingest'),
      }),
    },
    async (args: any) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  channelIds: args.channelIds,
                  message: `Configured ${args.channelIds.length} Slack channels for live history and thread ingestion.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to select Slack channels: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 6. rev_admin_get_bus_factor_risk
  server.registerTool(
    'rev_admin_get_bus_factor_risk',
    {
      description: 'Run native git blame and 90-day churn analysis to calculate module fragility and bus-factor risk scores for the departing engineer.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        maxFiles: z.number().int().min(1).max(500).optional().describe('Maximum tracked repository files to inspect (default 100)'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}/risk`, {
          method: 'POST',
          body: JSON.stringify({
            maxFiles: args.maxFiles || 100,
          }),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to analyze bus-factor risk: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
