import { describe, it } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import net from 'node:net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper to check if pipe/socket is accessible (works on both Unix and Windows)
async function isPipeAccessible(pipePath) {
  return new Promise(resolve => {
    const client = net.createConnection(pipePath)

    client.on('connect', () => {
      client.end()
      resolve(true)
    })

    client.on('error', () => {
      resolve(false)
    })

    setTimeout(() => {
      client.destroy()
      resolve(false)
    }, 1000)
  })
}

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

    // Verify pipe/socket is accessible (works on both Unix and Windows)
    const isAccessible = await isPipeAccessible(pipePath)
    assert.ok(isAccessible, 'Pipe/socket should be accessible after broker starts')

    // On Unix, also verify socket file exists
    if (process.platform !== 'win32') {
      assert.ok(existsSync(pipePath), 'Socket file should exist on Unix')
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

    // Verify pipe/socket is no longer accessible (works on both Unix and Windows)
    const isStillAccessible = await isPipeAccessible(pipePath)
    assert.ok(!isStillAccessible, 'Pipe/socket should be cleaned up after SIGINT')

    // On Unix, also verify socket file was removed
    if (process.platform !== 'win32') {
      assert.ok(!existsSync(pipePath), 'Socket file should be removed on Unix after SIGINT')
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

    // Verify pipe/socket is accessible (works on both Unix and Windows)
    const isAccessible = await isPipeAccessible(pipePath)
    assert.ok(isAccessible, 'Pipe/socket should be accessible after broker starts')

    // On Unix, also verify socket file exists
    if (process.platform !== 'win32') {
      assert.ok(existsSync(pipePath), 'Socket file should exist on Unix')
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

    // Verify pipe/socket is no longer accessible (works on both Unix and Windows)
    const isStillAccessible = await isPipeAccessible(pipePath)
    assert.ok(!isStillAccessible, 'Pipe/socket should be cleaned up after SIGTERM')

    // On Unix, also verify socket file was removed
    if (process.platform !== 'win32') {
      assert.ok(!existsSync(pipePath), 'Socket file should be removed on Unix after SIGTERM')
    }
  })

  it('should exit with code 0 on graceful shutdown', async () => {
    // Skip on Windows - child.kill('SIGINT') doesn't work the same way
    // Windows will forcefully terminate the process
    if (process.platform === 'win32') {
      console.log('# Skipping on Windows - SIGINT behavior differs')
      return
    }

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
