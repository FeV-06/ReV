import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { getEffectiveCoreEnv } from '@/lib/server/settings';

const resultSchema = z.discriminatedUnion('ok', [z.object({ok: z.literal(true), data: z.unknown()}), z.object({ok: z.literal(false), error: z.string()})]);
export async function callCore(op: object): Promise<unknown> {
  const bin = process.env.REV_CORE_BIN || path.join(process.cwd(), 'target', 'debug', 'rev-core');
  const env = await getEffectiveCoreEnv();
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, [], { stdio: ['pipe', 'pipe', 'ignore'], env });
    let output = ''; let finished = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Core operation timed out')); }, 150_000);
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
