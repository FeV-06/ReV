import { z } from 'zod';
import type { DaemonApiClient } from '../client';

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
            id: `task-${i + 1}`,
            task: item.text,
            verification: item.verification,
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
}
