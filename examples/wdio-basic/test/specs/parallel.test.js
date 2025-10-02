import { Client } from 'ephemeral-broker'
import assert from 'node:assert'

describe('Parallel Test Coordination', () => {
  let client

  before(async function () {
    // Connect to broker started in wdio.conf.js
    client = new Client(process.env.EPHEMERAL_PIPE, {
      secret: process.env.EPHEMERAL_SECRET || 'test-secret',
      allowNoTtl: true
    })

    // Verify broker is accessible
    await client.ping()
  })

  it('should lease unique test accounts for parallel workers', async function () {
    const workerId = `worker-${browser.sessionId}`

    // Lease a unique account number for this worker
    const accountNum = await client.lease('test-accounts', workerId, 60000)

    console.log(`Worker ${workerId} got account: ${accountNum}`)

    // Simulate using the account
    await browser.url('https://example.com')
    await browser.pause(100)

    // Store test results
    await client.set(`results-${accountNum}`, {
      workerId,
      accountNum,
      timestamp: Date.now(),
      status: 'passed'
    })

    // Release the account when done
    await client.release(workerId)

    assert.ok(accountNum >= 1 && accountNum <= 10, 'Account number should be 1-10')
  })

  it('should share authentication tokens across workers', async function () {
    const workerId = `worker-${browser.sessionId}`

    // First worker to run stores the token
    let token
    try {
      token = await client.get('auth-token')
    } catch {
      // Token doesn't exist yet - generate one
      token = `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      await client.set('auth-token', token)
      console.log(`Worker ${workerId} generated token: ${token}`)
    }

    // All workers use the same token
    console.log(`Worker ${workerId} using token: ${token}`)
    assert.ok(token.startsWith('token-'), 'Token should have correct format')
  })

  it('should coordinate rate limits across parallel tests', async function () {
    const workerId = `worker-${browser.sessionId}`

    // Atomic increment using lease/release pattern
    const counter = await client.lease('api-calls', workerId, 5000)

    console.log(`Worker ${workerId} - API call #${counter}`)

    // Simulate API call with rate limiting
    await browser.pause(50)

    await client.release(workerId)

    assert.ok(counter > 0, 'Counter should be positive')
  })
})
