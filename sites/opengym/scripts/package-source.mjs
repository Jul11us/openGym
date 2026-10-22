// The hosted About screen offers the complete modified application source.
// Use an explicit source allowlist so runtime state and credentials never enter the ZIP.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSourceHostingConfig, sourceFileAllowed } from './source-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['app', 'api', 'build', 'components', 'hooks', 'vendor', 'db', 'drizzle', 'lib', 'scripts', 'tests', 'gym-client', '.openai/hosting.json', 'README.md', 'LICENSE', 'NOTICE.md', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite-env.d.ts', 'cloudflare-env.d.ts', 'drizzle.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'next.config.ts', 'components.json', 'eslint.config.mjs', '.npmrc', '.gitignore'];
const ignored = new Set(['node_modules', 'dist', '.git', '.wrangler', '.sites-runtime', 'coverage', 'outputs', 'work', 'exercise-media']);
const files = [];
function walk(relative) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return;
  if (ignored.has(path.basename(relative)) || !sourceFileAllowed(relative)) return;
  if (statSync(full).isDirectory()) for (const child of readdirSync(full).sort()) walk(path.join(relative, child));
  else files.push(relative);
}
for (const entry of roots) walk(entry);
const localParts = [], directoryParts = [];
let offset = 0;
for (const relative of files) {
  const name = Buffer.from(relative.replaceAll('\\', '/'));
  const rawSource = readFileSync(path.join(root, relative));
  const source = relative.replaceAll('\\', '/') === '.openai/hosting.json'
    ? Buffer.from(JSON.stringify(publicSourceHostingConfig(JSON.parse(rawSource.toString('utf8'))), null, 2) + '\n')
    : rawSource;
  const packed = deflateRawSync(source);
  const checksum = crc32(source);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, packed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  directoryParts.push(central, name);
  offset += local.length + name.length + packed.length;
}
const directory = Buffer.concat(directoryParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(path.join(root, 'public'), { recursive: true });
writeFileSync(path.join(root, 'public/source.zip'), Buffer.concat([...localParts, directory, end]));
console.log(`Source download prepared: ${files.length} source files.`);
