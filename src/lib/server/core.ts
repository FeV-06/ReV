import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { getEffectiveCoreEnv } from '@/lib/server/settings';

const resultSchema = z.discriminatedUnion('ok', [z.object({ok: z.literal(true), data: z.unknown()}), z.object({ok: z.literal(false), error: z.string()})]);
const providerOperations = new Set(['generate', 'prepare_interview', 'answer_successor', 'detect_divergence']);

export async function callCore(op: { op: string; sources?: { text: string }[]; [key: string]: unknown }): Promise<unknown> {
  const env = await getEffectiveCoreEnv();
  const isOversize = (error: unknown) => error instanceof Error && [
    'Model provider returned HTTP 413',
    'Model input exceeded the provider context limit',
  ].includes(error.message);
  const isDraftFormatError = (error: unknown) => op.op === 'generate' && error instanceof Error && [
    'Model did not return the requested JSON object',
    'Model response has no items array',
    'Model response contained no text',
    'Model reply was cut off before it finished',
  ].includes(error.message);
  const formatError = 'The model could not produce a complete handover draft after retrying. Try selecting fewer sources or choosing a different model.';
  let retryingFormatError = false;
  try {
    return await runCore(op, env);
  } catch (error) {
    if ((!isOversize(error) && !isDraftFormatError(error)) || !providerOperations.has(op.op) || !op.sources?.length) throw error;
    retryingFormatError = isDraftFormatError(error);
  }

  const minimumSources = op.op === 'detect_divergence' ? 2 : 1;
  let previousSize = Buffer.byteLength(JSON.stringify(op.sources));
  for (const [budget, excerptLength] of [[24_000, 2800], [10_000, 1200], [4_000, 480]]) {
    const sources = [];
    let bytes = 1;
    for (const source of op.sources) {
      const excerpt = { ...source, text: source.text.slice(0, excerptLength).replace(/[\uD800-\uDBFF]$/, '') };
      const size = Buffer.byteLength(JSON.stringify(excerpt)) + 1;
      if (bytes + size > budget) continue;
      sources.push(excerpt);
      bytes += size;
    }
    if (sources.length < minimumSources || bytes >= previousSize) continue;
    previousSize = bytes;
    try {
      return await runCore({ ...op, sources, ...(retryingFormatError ? { compactDraft: true } : {}) }, env);
    } catch (error) {
      if (isDraftFormatError(error)) {
        if (retryingFormatError) throw new Error(formatError);
        retryingFormatError = true;
      } else if (!isOversize(error)) throw error;
    }
  }
  if (retryingFormatError) {
    if (previousSize < Buffer.byteLength(JSON.stringify(op.sources))) throw new Error(formatError);
    try {
      return await runCore({ ...op, compactDraft: true }, env);
    } catch (error) {
      if (!isDraftFormatError(error) && !isOversize(error)) throw error;
      throw new Error(formatError);
    }
  }
  throw new Error('The model provider rejected the request size even with fewer sources. Select fewer sources or use a model endpoint that accepts larger requests.');
}

async function runCore(op: object, env: NodeJS.ProcessEnv): Promise<unknown> {
  const bin = process.env.REV_CORE_BIN || path.join(process.cwd(), 'target', 'debug', 'rev-core');
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, [], { stdio: ['pipe', 'pipe', 'ignore'], env });
    let output = ''; let finished = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Core operation timed out')); }, 330_000);
    function finish(error?: Error, value?: unknown) { if (finished) return; finished = true; clearTimeout(timer); if (error) reject(error); else resolve(value); }
    child.on('error', () => finish(new Error('Rust core unavailable. Run cargo build first.')));
    child.stdin.on('error', () => finish(new Error('Rust core closed its input unexpectedly')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 20_000_000) { child.kill(); finish(new Error('Core response exceeded limit')); } });
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error('Rust core failed'));
      try { const result = resultSchema.parse(JSON.parse(output)); if (!result.ok) return finish(new Error(result.error)); finish(undefined, result.data); }
      catch { finish(new Error('Rust core returned invalid data')); }
    });
    child.stdin.end(JSON.stringify(op));
  });
}
