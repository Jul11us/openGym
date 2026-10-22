// These copied contract tests still verify the upstream Docker/native/catalogue
// sources. Find that checkout without depending on the hosted client's nesting.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let root = dirname(fileURLToPath(import.meta.url))
while (!existsSync(join(root, 'api', 'server.js')) || !existsSync(join(root, 'frontend', 'package.json'))) {
  const parent = dirname(root)
  if (parent === root) throw new Error('Upstream contract tests require the openGym repository root (api/ and frontend/).')
  root = parent
}

export const upstreamPath = (...parts) => join(root, ...parts)
