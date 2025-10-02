import { describe, it } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper to create a standalone broker process
function createBrokerProcess() {
  const brokerScript = join(__dirname, 'fixtures', 'standalone-broker.js')
  return spawn('node', [brokerScript], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

describe('Graceful Shutdown', () => {
  it('should handle SIGINT and cleanup socket file', async () => {
    const broker = createBrokerProcess()
    let pipePath = null

    // Wait for broker to start and get pipe path
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker start timeout')), 5000)

      broker.stdout.on('data', data => {
        const output = data.toString()
        const match = output.match(/PIPE_PATH:(.+)/)
        if (match) {
          pipePath = match[1].trim()
          clearTimeout(timeout)
          resolve()
        }
      })

      broker.on('error', err => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    assert.ok(pipePath, 'Should have received pipe path')

    // On Unix, verify socket file exists (Windows named pipes don't create files)
    if (process.platform !== 'win32') {
      assert.ok(existsSync(pipePath), 'Socket file should exist after broker starts')
    }

    // Send SIGINT
    broker.kill('SIGINT')

    // Wait for broker to exit
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker exit timeout')), 5000)

      broker.on('exit', code => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // On Unix, verify socket file was cleaned up (Windows named pipes don't create files)
    if (process.platform !== 'win32') {
      assert.ok(!existsSync(pipePath), 'Socket file should be removed after SIGINT')
    }
  })

  it('should handle SIGTERM and cleanup socket file', async () => {
    const broker = createBrokerProcess()
    let pipePath = null

    // Wait for broker to start and get pipe path
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker start timeout')), 5000)

      broker.stdout.on('data', data => {
        const output = data.toString()
        const match = output.match(/PIPE_PATH:(.+)/)
        if (match) {
          pipePath = match[1].trim()
          clearTimeout(timeout)
          resolve()
        }
      })

      broker.on('error', err => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    assert.ok(pipePath, 'Should have received pipe path')

    // On Unix, verify socket file exists (Windows named pipes don't create files)
    if (process.platform !== 'win32') {
      assert.ok(existsSync(pipePath), 'Socket file should exist after broker starts')
    }

    // Send SIGTERM
    broker.kill('SIGTERM')

    // Wait for broker to exit
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker exit timeout')), 5000)

      broker.on('exit', code => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // On Unix, verify socket file was cleaned up (Windows named pipes don't create files)
    if (process.platform !== 'win32') {
      assert.ok(!existsSync(pipePath), 'Socket file should be removed after SIGTERM')
    }
  })

  it('should exit with code 0 on graceful shutdown', async () => {
    const broker = createBrokerProcess()

    // Wait for broker to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker start timeout')), 5000)

      broker.stdout.on('data', data => {
        const output = data.toString()
        if (output.includes('PIPE_PATH:')) {
          clearTimeout(timeout)
          resolve()
        }
      })

      broker.on('error', err => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // Send SIGINT
    broker.kill('SIGINT')

    // Wait for broker to exit and get exit code
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broker exit timeout')), 5000)

      broker.on('exit', code => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    assert.strictEqual(exitCode, 0, 'Should exit with code 0 on graceful shutdown')
  })
})
