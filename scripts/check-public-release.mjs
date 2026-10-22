import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
let scanned = 0;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['access token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b/],
  ['live Sites identifier', /\bappgprj_[a-f0-9]{32}\b/i],
  ['private Windows workspace path', /[A-Z]:[\\/](?:Users[\\/][^\\/\s"]+|correct things)[\\/]/i],
];
for (const file of new Set(files)) {
  if (/^(?:my-plans|outputs|coach-auth)\//.test(file) || /^sites\/opengym\/(?:outputs|data|dist|generated|\.wrangler|\.sites-runtime|work)\//.test(file)) {
    problems.push({ file, reason: 'local-only directory' });
    continue;
  }
  if (/^sites\/opengym\/.+(?:\.(?:sqlite3?|db|pem|key|log|tar|zip)|\/.env(?:\..+)?)$/.test(file) && !file.includes('/tests/')) {
    problems.push({ file, reason: 'runtime or credential file' });
    continue;
  }
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) continue;
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) continue;
  scanned++;
  const text = bytes.toString('utf8');
  for (const [reason, expression] of rules) if (expression.test(text)) problems.push({ file, reason });
}
if (problems.length) {
  console.error(JSON.stringify({ publicFileCheck: 'failed', problems }, null, 2));
  process.exitCode = 1;
} else console.log(JSON.stringify({ publicFileCheck: 'passed', files: new Set(files).size, textFiles: scanned }));
