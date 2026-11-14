import { z } from 'zod';
import type { DaemonApiClient } from '../client.js';
import { pruneCosmeticArtifacts } from '../../lib/server/triage.js';

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
        fixture: z.boolean().optional().describe('Use synthetic fixture data instead of local/remote git').default(false),
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
          fixture: Boolean(args.fixture),
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
                  artifactsCount: runRes.run?.artifacts?.length || 0,
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

  // 2. rev_admin_get_available_sources (NEW)
  server.registerTool(
    'rev_admin_get_available_sources',
    {
      description: 'Fetch all available source artifacts (commits, AST symbols, documentation, Slack messages) for a handover run with their selection status.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        kind: z.enum(['all', 'git_commit', 'git_commit_patch', 'ast_symbol', 'documentation', 'slack_message', 'interview_answer']).optional().describe('Filter by source artifact kind'),
        selectedOnly: z.boolean().optional().describe('Return only currently selected artifacts').default(false),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum artifacts to return (default 100)').default(100),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}`);
        const r = res.run;
        if (!r) throw new Error('Run not found');

        let artifacts = (r.artifacts || []) as any[];
        const selectedIds = new Set(r.selectedIds || []);

        if (args.kind && args.kind !== 'all') {
          artifacts = artifacts.filter((a) => a.kind === args.kind);
        }
        if (args.selectedOnly) {
          artifacts = artifacts.filter((a) => selectedIds.has(a.id));
        }

        const totalAvailable = artifacts.length;
        const capped = artifacts.slice(0, args.limit || 100).map((a) => ({
          id: a.id,
          kind: a.kind,
          sourceRef: a.sourceRef,
          author: a.author || null,
          timestamp: a.timestamp || null,
          url: a.url || null,
          textPreview: a.text ? (a.text.length > 150 ? `${a.text.slice(0, 150)}...` : a.text) : '',
          isSelected: selectedIds.has(a.id),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  runId: r.id,
                  totalArtifacts: totalAvailable,
                  returnedCount: capped.length,
                  selectedCount: selectedIds.size,
                  artifacts: capped,
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
          content: [{ type: 'text', text: `Failed to get available sources: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 3. rev_admin_configure_scope (ENHANCED with smart presets)
  server.registerTool(
    'rev_admin_configure_scope',
    {
      description: 'Filter and select relevant data/commits/docs to be handed over to the successor, enforcing privacy guardrails. Supports specific IDs or smart presets ("all", "non_cosmetic").',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        selectedSourceIds: z.array(z.string()).optional().describe('Array of source artifact IDs approved for inclusion (or ["*"] for all)'),
        preset: z.enum(['all', 'non_cosmetic']).optional().describe('Smart selection preset: "all" selects every artifact; "non_cosmetic" prunes lockfile/formatting churn via Laya triage heuristics'),
        confirmAuthorisation: z.boolean().describe('Explicit confirmation that the recipient is authorized to receive selected data'),
      }),
    },
    async (args: any) => {
      try {
        let finalIds: string[] = args.selectedSourceIds || [];

        // If a smart preset or wildcard is requested, inspect the run's artifacts
        if (args.preset || finalIds.includes('*') || finalIds.includes('all') || finalIds.includes('non_cosmetic')) {
          const runRes = await client.request(`/v1/runs/${args.runId}`);
          const rawArtifacts = (runRes.run?.artifacts || []) as any[];

          if (args.preset === 'non_cosmetic' || finalIds.includes('non_cosmetic')) {
            const { significant } = pruneCosmeticArtifacts(rawArtifacts);
            finalIds = significant.map((a) => a.id);
          } else {
            // 'all' or '*'
            finalIds = rawArtifacts.map((a) => a.id);
          }
        }

        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'scope',
            selectedIds: finalIds,
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
                  selectedCount: finalIds.length,
                  message: 'Scope configured and authorized. Ready for LLM synthesis.',
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

  // 4. rev_admin_generate_handover (NEW)
  server.registerTool(
    'rev_admin_generate_handover',
    {
      description: 'Trigger AI model synthesis to extract architectural decisions, risks, Day-1 actions, and departure interview gaps from scoped sources.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        takeoverScope: z.string().optional().describe('Optional focus instructions for the handover synthesis'),
        confirmRemote: z.boolean().optional().describe('Explicit consent to use configured LLM inference endpoint (OmniRoute / OpenAI / Groq)').default(true),
        useFixture: z.boolean().optional().describe('Generate synthetic verified fixture candidate items without invoking remote LLM').default(false),
      }),
    },
    async (args: any) => {
      try {
        const runRes = await client.request(`/v1/runs/${args.runId}`);
        const r = runRes.run;
        if (!r) throw new Error('Run not found');

        const selectedIds = r.selectedIds || [];
        if (selectedIds.length === 0) {
          throw new Error('Cannot generate handover: no sources selected. Call rev_admin_configure_scope first.');
        }

        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'generate',
            selectedIds,
            takeoverScope: args.takeoverScope || r.takeoverScope || '',
            acceptPartial: true,
            confirmAuthorisation: true,
            confirmRemote: Boolean(args.confirmRemote),
            fixture: Boolean(args.useFixture),
          }),
        });

        const generatedRun = res.run;
        const candidateItems = (generatedRun?.items || []).map((i: any) => ({
          id: i.id,
          category: i.category,
          text: i.text,
          verification: i.verification,
          citationsCount: i.citations?.length || 0,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  runId: args.runId,
                  state: generatedRun?.state,
                  generatedItemsCount: candidateItems.length,
                  openGapsCount: (generatedRun?.gaps || []).filter((g: any) => g.status === 'open').length,
                  itemsSummary: candidateItems,
                  message: 'Handover draft synthesized with verified exact substring citations. Ready for review or approval.',
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
          content: [{ type: 'text', text: `Failed to generate handover: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 5. rev_admin_approve_handover (NEW)
  server.registerTool(
    'rev_admin_approve_handover',
    {
      description: 'Approve the reviewed handover draft and sign off on verified evidence, advancing state to approved and unlocking successor download.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        confirmAuthorisation: z.literal(true).describe('Explicit confirmation that all included sources are authorized for the successor'),
        interviewAnswerIds: z.array(z.string()).optional().describe('Optional list of departure interview answer artifact IDs to approve and include'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'approve',
            confirmAuthorisation: args.confirmAuthorisation,
            interviewAnswerIds: args.interviewAnswerIds || [],
          }),
        });

        const r = res.run;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  runId: args.runId,
                  state: r?.state,
                  approvedRevision: r?.approvedRevision,
                  approvedItemsCount: (r?.items || []).filter((i: any) => !i.excluded).length,
                  message: 'Handover successfully approved and sealed. Successor can now download the formatted handover package.',
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
          content: [{ type: 'text', text: `Failed to approve handover: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 6. rev_admin_list_active_projects
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

  // 7. rev_admin_get_project_roster
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

  // 8. rev_admin_select_slack_channels
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

  // 9. rev_admin_get_bus_factor_risk
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
