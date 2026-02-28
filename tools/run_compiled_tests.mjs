import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const files = [
  resolve('node_modules/.tmp/tests/tests/domain.test.js'),
  resolve('node_modules/.tmp/tests/tests/events.test.js'),
  resolve('node_modules/.tmp/tests/tests/ranking.test.js'),
  resolve('node_modules/.tmp/tests/tests/timeline.test.js'),
]

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
