#!/usr/bin/env node
import { installAutostart, uninstallAutostart, getAutostartStatus, generateSystemdUnit, generateWindowsStartupScript, resolveServiceConfig } from '../dist/daemon/autostart.js';

const args = process.argv.slice(2);
const command = args[0] || 'status';

function parseFlags(items) {
  const flags = { dryRun: false, enable: true, platform: undefined };
  for (let i = 0; i < items.length; i++) {
    if (items[i] === '--dry-run') flags.dryRun = true;
    if (items[i] === '--no-enable') flags.enable = false;
    if (items[i] === '--platform' && items[i + 1]) {
      flags.platform = items[i + 1];
      i++;
    }
  }
  return flags;
}

const flags = parseFlags(args.slice(1));

async function main() {
  switch (command) {
    case 'status': {
      const status = await getAutostartStatus({ platform: flags.platform });
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case 'install': {
      const result = await installAutostart({
        platform: flags.platform,
        dryRun: flags.dryRun,
        enable: flags.enable,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'uninstall': {
      const result = await uninstallAutostart({
        platform: flags.platform,
        dryRun: flags.dryRun,
        enable: flags.enable,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'generate': {
      const platform = flags.platform || (process.platform === 'win32' ? 'win32' : 'linux');
      const config = resolveServiceConfig();
      if (platform === 'linux') {
        console.log(generateSystemdUnit(config));
      } else {
        console.log(generateWindowsStartupScript(config));
      }
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Usage: daemon-autostart [status|install|uninstall|generate] [--dry-run] [--no-enable] [--platform <linux|win32>]');
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error(`Autostart error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
