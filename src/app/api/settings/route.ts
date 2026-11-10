import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { loadSettings, saveSettings } from '@/lib/server/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const settings = await loadSettings();
    const envHasPostgres = Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
    return Response.json({
      settings,
      hasSupabaseConfigured: Boolean(settings.postgresUri.trim() || envHasPostgres),
    });
  } catch (err) {
    return Response.json({ error: clientError(err) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await request.json();
    const saved = await saveSettings(body);
    return Response.json({
      success: true,
      settings: saved,
      hasSupabaseConfigured: Boolean(
        saved.postgresUri.trim() || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
      ),
    });
  } catch (err) {
    return Response.json({ error: clientError(err) }, { status: 400 });
  }
}

