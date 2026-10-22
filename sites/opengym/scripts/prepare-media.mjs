import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../../catalogue/media');
const destination = path.join(root, 'gym-client/public/exercise-media');
const entries = ['still', 'clip', 'NOTICE.md'];

export function prepareExerciseMedia() {
  if (entries.every(entry => existsSync(path.join(source, entry)))) {
    mkdirSync(destination, { recursive: true });
    for (const entry of entries) cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
    console.log('Unmodified exercise media prepared from the repository catalogue.');
    return;
  }
  if (entries.every(entry => existsSync(path.join(destination, entry)))) return;
  throw new Error('Exercise media is missing. Use a full repository checkout, or obtain the unmodified openGym media and its NOTICE.md under the terms in NOTICE.md.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareExerciseMedia();
