import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const app = fileURLToPath(new URL('..', import.meta.url));
const url = 'http://127.0.0.1:3077';
const next = resolve(app, 'node_modules/next/dist/bin/next');
if (!existsSync(next)) throw new Error('Install ReV dependencies before launching the dashboard.');

let checkout;
try {
  checkout = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
} catch {
  throw new Error('Run the ReV launcher from inside the project checkout.');
}

async function ready() {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

if (await ready()) throw new Error('Port 3077 is already in use. Stop the existing dashboard before switching projects.');
const server = spawn(process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', '3077'], {
  cwd: app, env: { ...process.env, REV_GIT_DIR: checkout }, stdio: 'inherit',
});
server.once('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.kill(signal));

for (let attempt = 0; attempt < 60 && server.exitCode === null && server.signalCode === null; attempt++) {
  await setTimeout(500);
  if (!await ready() || server.exitCode !== null || server.signalCode !== null) continue;
  const opener = process.platform === 'darwin' ? ['open', url] :
    process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url];
  const browser = spawn(opener[0], opener.slice(1), { stdio: 'ignore' });
  browser.once('error', () => console.log(`Open ${url} in your browser.`));
  browser.once('exit', code => { if (code) console.log(`Open ${url} in your browser.`); });
  break;
}
