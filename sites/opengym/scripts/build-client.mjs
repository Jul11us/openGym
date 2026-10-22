import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExerciseMedia } from './prepare-media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'gym-client');
prepareExerciseMedia();
if (!existsSync(path.join(client, 'node_modules/vite/bin/vite.js'))) {
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const install = spawnSync(process.execPath, [npm, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], { cwd: client, stdio: 'inherit' });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status || 1);
}
const built = spawnSync(process.execPath, [path.join(client, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: client,
  env: { ...process.env, VITE_SITES: '1' },
  stdio: 'inherit',
});
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status || 1);
mkdirSync(path.join(root, 'generated'), { recursive: true });
mkdirSync(path.join(root, 'public'), { recursive: true });
const dist = path.join(client, 'dist');
writeFileSync(path.join(root, 'generated/gym.html'), readFileSync(path.join(dist, 'index.html')));
for (const name of readdirSync(dist)) {
  if (name === 'index.html') continue;
  cpSync(path.join(dist, name), path.join(root, 'public', name), { recursive: true });
}
console.log('openGym client prepared for Sites.');
