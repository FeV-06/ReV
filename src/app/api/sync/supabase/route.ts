import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { syncToSupabase, testPostgresConnection } from '@/lib/server/sync-supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await request.json().catch(() => ({}));
    const connectionString =
      (body.connectionString as string | undefined)?.trim() ||
      process.env.SUPABASE_DB_URL ||
      process.env.DATABASE_URL ||
      '';

    if (body.testOnly === true) {
      if (!connectionString) {
        return Response.json(
          { success: false, error: 'No connection string provided' },
          { status: 400 }
        );
      }
      const testResult = await testPostgresConnection(connectionString);
      return Response.json(testResult, { status: testResult.success ? 200 : 400 });
    }

    if (!connectionString) {
      return Response.json(
        {
          success: false,
          fallback: 'local',
          error: 'No Supabase connection configured. Data remains safe in local PGlite.',
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    const result = await syncToSupabase(connectionString, body.runId as string | undefined);
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return Response.json({ error: clientError(err) }, { status: 400 });
  }
}
