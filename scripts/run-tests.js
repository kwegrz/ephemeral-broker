import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const testDir = 'test'
const files = readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .map(f => join(testDir, f))

const child = spawn('node', ['--test', ...files], {
  stdio: 'inherit',
  shell: false
})

child.on('exit', code => process.exit(code))
