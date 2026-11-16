import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(root, 'dist');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'styles.css', 'mobile-accessibility.css', 'guide.js', 'favicon.svg', 'assets']) {
  await cp(path.join(root, name), path.join(destination, name), { recursive: true });
}
console.log(`Built static judge guide at ${destination}`);
