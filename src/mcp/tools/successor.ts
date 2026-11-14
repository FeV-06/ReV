import { z } from 'zod';
import type { DaemonApiClient } from '../client.js';

export function registerSuccessorTools(server: any, client: DaemonApiClient) {
  // 1. rev_successor_get_project_info
  server.registerTool(
    'rev_successor_get_project_info',
    {
      description: 'Get high-level project overview, target role, predecessor info, and Day-1 onboarding checklist.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}`);
        const r = res.run;
        if (!r) throw new Error('Run not found');

        const checklist = (r.items || [])
          .filter((item: any) => item.category === 'next_action')
          .map((item: any, i: number) => ({
            id: item.id || `task-${i + 1}`,
            task: item.text,
            verification: item.verification,
            completed: Boolean(item.completed),
            evidenceQuotes: (item.evidence || []).map((e: any) => e.quote),
          }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  runId: r.id,
                  projectRecipient: r.recipient,
                  predecessor: r.departingPerson || r.githubUsername || 'Predecessor',
                  targetRole: r.targetRole || 'Engineer',
                  state: r.state,
                  createdAt: r.createdAt,
                  approvedRevision: r.approvedRevision,
                  dayOneChecklist: checklist,
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
          content: [{ type: 'text', text: `Failed to get project info: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 2. rev_successor_download_artifacts
  server.registerTool(
    'rev_successor_download_artifacts',
    {
      description: 'Download the approved, publication-ready handover package (Markdown document with line citations).',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
      }),
    },
    async (args: any) => {
      try {
        const markdown = await client.request<string>(`/v1/runs/${args.runId}/export`);
        return {
          content: [
            {
              type: 'text',
              text: typeof markdown === 'string' ? markdown : JSON.stringify(markdown, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to download artifacts: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 3. rev_successor_raise_question
  server.registerTool(
    'rev_successor_raise_question',
    {
      description: 'Ask questions to the handover engine. Returns verbatim citations; if unanswered, automatically escalates a follow-up question to the departing person.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        question: z.string().describe('The question about legacy decisions, architecture, or setup steps'),
        confirmRemote: z.boolean().optional().describe('Consent to use configured model provider for answering').default(true),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}/ask`, {
          method: 'POST',
          body: JSON.stringify({
            question: args.question,
            confirmRemote: args.confirmRemote !== false,
          }),
        });

        const hasAnswer = Boolean(res.answer);
        const hasEscalatedFollowUp = Boolean(res.followUp);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  question: args.question,
                  hasAnswer,
                  answer: res.answer || 'No direct evidence found in approved handover scope.',
                  citations: res.citations || [],
                  escalatedToDepartingPerson: hasEscalatedFollowUp,
                  followUpQuestion: res.followUp || null,
                  note: hasEscalatedFollowUp
                    ? 'This question has been automatically queued as an open gap question for the departing engineer.'
                    : 'Answer backed by exact substring quote verification.',
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
          content: [{ type: 'text', text: `Failed to process question: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 4. rev_successor_update_checklist (NEW)
  server.registerTool(
    'rev_successor_update_checklist',
    {
      description: 'Update the status or notes of a Day-1 onboarding checklist task.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        taskId: z.string().describe('The task ID (e.g. real item UUID or "task-1")'),
        completed: z.boolean().describe('Whether the onboarding task has been completed and verified'),
        notes: z.string().optional().describe('Optional successor notes or verified command output'),
      }),
    },
    async (args: any) => {
      try {
        const runRes = await client.request(`/v1/runs/${args.runId}`);
        const r = runRes.run;
        if (!r) throw new Error('Run not found');

        const items = [...(r.items || [])];
        let found = false;
        let taskIndex = 0;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.category === 'next_action') {
            taskIndex++;
            if (item.id === args.taskId || `task-${taskIndex}` === args.taskId) {
              items[i] = {
                ...item,
                completed: args.completed,
                ...(args.notes ? { text: `${item.text.replace(/ \[[^\]]+\]$/, '')} [${args.notes}]` } : {}),
              };
              found = true;
              break;
            }
          }
        }

        if (!found) {
          throw new Error(`Task ${args.taskId} not found in next_action checklist`);
        }

        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'save',
            items,
          }),
        });

        const remainingCount = (res.run?.items || [])
          .filter((i: any) => i.category === 'next_action' && !i.completed).length;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  runId: args.runId,
                  taskId: args.taskId,
                  completed: args.completed,
                  remainingIncompleteTasks: remainingCount,
                  message: `Task ${args.taskId} marked as ${args.completed ? 'completed' : 'pending'}.`,
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
          content: [{ type: 'text', text: `Failed to update checklist task: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 5. rev_successor_inspect_module (NEW)
  server.registerTool(
    'rev_successor_inspect_module',
    {
      description: 'Inspect bus-factor fragility, ownership fraction, and departing lines for a specific file or module path.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        modulePath: z.string().describe('Relative file or directory path in the repository (e.g. "src/lib/server/store.ts")'),
      }),
    },
    async (args: any) => {
      try {
        const riskRes = await client.request(`/v1/runs/${args.runId}/risk`, {
          method: 'POST',
          body: JSON.stringify({ maxFiles: 150 }),
        });

        const target = args.modulePath.toLowerCase().replace(/^[./\\]+/, '');
        const modules = (riskRes?.modules || []) as any[];
        const matched = modules.find((m) => m.path?.toLowerCase().includes(target));

        if (!matched) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    modulePath: args.modulePath,
                    found: false,
                    message: `No risk data found matching "${args.modulePath}". File may not be tracked in git or within the inspected churn threshold.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  modulePath: matched.path,
                  found: true,
                  ownershipFraction: matched.ownershipFraction,
                  departingLines: matched.departingLines,
                  totalLines: matched.totalLines,
                  fragilityScore: matched.score,
                  explanation: matched.explanation,
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
          content: [{ type: 'text', text: `Failed to inspect module risk: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
