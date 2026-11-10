import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const settingsSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'ollama']).default('openai'),
  apiKey: z.string().max(500).default(''),
  modelName: z.string().max(200).default('gpt-4o'),
  baseUrl: z.string().max(500).default('https://api.openai.com/v1'),
  githubToken: z.string().max(500).default(''),
  dbMode: z.enum(['pglite', 'supabase']).default('pglite'),
  postgresUri: z.string().max(1000).default(''),
});

export type SystemSettings = z.infer<typeof settingsSchema>;

function settingsFilePath(): string {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.REV_DATA_DIR || '.rev-data');
  return path.join(dir, 'settings.json');
}

async function readSavedSettings(): Promise<SystemSettings | null> {
  try {
    const raw = await readFile(settingsFilePath(), 'utf8');
    return settingsSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<SystemSettings> {
  return (await readSavedSettings()) ?? settingsSchema.parse({});
}

export async function saveSettings(input: unknown): Promise<SystemSettings> {
  const parsed = settingsSchema.parse(input);
  const filePath = settingsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
  return parsed;
}

/**
 * Merges persisted Settings Hub values into process.env for rev-core invocations.
 * Explicit Settings Hub values override environment defaults when configured.
 */
export async function getEffectiveCoreEnv(): Promise<NodeJS.ProcessEnv> {
  const settings = await readSavedSettings();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!settings) return env;

  if (settings.provider) env.REV_MODEL_PROVIDER = settings.provider;
  if (settings.baseUrl.trim()) env.REV_MODEL_BASE_URL = settings.baseUrl.trim();
  if (settings.modelName.trim()) env.REV_MODEL_NAME = settings.modelName.trim();
  if (settings.apiKey.trim()) env.REV_MODEL_API_KEY = settings.apiKey.trim();
  if (settings.githubToken.trim()) env.REV_GITHUB_TOKEN = settings.githubToken.trim();

  return env;
}

