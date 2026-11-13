import { z } from 'zod';
import type { DaemonApiClient } from '../client';

export function registerDepartingTools(server: any, client: DaemonApiClient) {
  // 1. rev_departing_list_projects
  server.registerTool(
    'rev_departing_list_projects',
    {
      description: 'List all handover projects from which the departing engineer is scheduled to be offboarded, with question counts.',
      inputSchema: z.object({
        departingIdentifier: z.string().optional().describe('Departing engineer name, GitHub handle, or email'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request('/v1/runs');
        let runs = (res.runs || []) as any[];
        if (args.departingIdentifier) {
          const id = args.departingIdentifier.toLowerCase().replace(/^@/, '');
          runs = runs.filter(
            (r) =>
              (r.departingPerson && r.departingPerson.toLowerCase().includes(id)) ||
              (r.departingEmail && r.departingEmail.toLowerCase().includes(id)) ||
              (r.githubUsername && r.githubUsername.toLowerCase().includes(id))
          );
        }
        const departingList = runs.map((r) => ({
          runId: r.id,
          projectRecipient: r.recipient,
          departingPerson: r.departingPerson || r.githubUsername,
          state: r.state,
          openQuestionsCount: (r.gaps || []).filter((g: any) => g.status === 'open').length,
          totalQuestionsCount: (r.gaps || []).length,
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: departingList.length,
                  projects: departingList,
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
          content: [{ type: 'text', text: `Failed to list departing projects: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 2. rev_departing_get_questions
  server.registerTool(
    'rev_departing_get_questions',
    {
      description: 'Fetch the evidence-backed architectural questions generated for the departing engineer by ReV.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}`);
        const r = res.run;
        if (!r) throw new Error('Run not found');
        const gaps = (r.gaps || []).map((g: any) => ({
          gapId: g.id,
          question: g.question,
          status: g.status,
          origin: g.origin || 'interview',
          evidence: g.evidence || [],
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  runId: r.id,
                  departingPerson: r.departingPerson || r.githubUsername,
                  totalQuestions: gaps.length,
                  openQuestions: gaps.filter((g: any) => g.status === 'open').length,
                  questions: gaps,
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
          content: [{ type: 'text', text: `Failed to get departure questions: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // 3. rev_departing_submit_answer
  server.registerTool(
    'rev_departing_submit_answer',
    {
      description: 'Submit an explanation/answer to a departure interview question, saving it as a cited review answer artifact.',
      inputSchema: z.object({
        runId: z.string().describe('Handover run ID'),
        gapId: z.string().describe('The ID of the question/gap being answered'),
        answerText: z.string().describe('The context, explanation, or instructions answering the question'),
      }),
    },
    async (args: any) => {
      try {
        const res = await client.request(`/v1/runs/${args.runId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'answer_gap',
            gapId: args.gapId,
            answer: args.answerText,
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
                  gapId: args.gapId,
                  state: res.run?.state,
                  message: 'Answer recorded into review queue as an unselected evidence artifact. Requires lead approval.',
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
          content: [{ type: 'text', text: `Failed to submit answer: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
