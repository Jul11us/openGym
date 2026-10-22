import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSourceHostingConfig, sourceFileAllowed } from '../scripts/source-config.mjs';

test('source download keeps binding names and excludes deployment identity and credentials', () => {
  const privateConfig = { d1: 'DB', r2: 'BUCKET', project_id: 'private-site', token: 'synthetic-secret', source_repository_credential: { token: 'synthetic-secret' } };
  assert.deepEqual(publicSourceHostingConfig(privateConfig), { d1: 'DB', r2: 'BUCKET' });
  assert.equal(privateConfig.project_id, 'private-site');
});

test('source download never treats an object or an identifier value as a binding name', () => {
  assert.deepEqual(publicSourceHostingConfig({ d1: { database_id: 'private-database' }, r2: 'private-id' }), {});
});

test('source download excludes logs, databases, credentials and archives inside source directories', () => {
  for (const file of ['gym-client/debug.log', 'gym-client/.env.local', 'tests/private.sqlite', 'app/client.pem', 'api/backup.zip']) {
    assert.equal(sourceFileAllowed(file), false, file);
  }
  for (const file of ['app/page.tsx', 'scripts/package-source.mjs', 'gym-client/public/icon-180.png']) {
    assert.equal(sourceFileAllowed(file), true, file);
  }
});
