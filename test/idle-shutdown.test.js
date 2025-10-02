import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

describe('Idle Shutdown', () => {
  it('should shutdown after idle timeout period', async () => {
    const broker = new Broker({
      debug: false,
      idleTimeout: 1000, // 1 second idle timeout
      requireTTL: false
    })

    await broker.start()
    const client = new Client(broker.pipe)

    // Make initial request to establish activity
    await client.set('test', 'value', 5000)

    // Record broker start
    const startTime = Date.now()

    // Wait for idle timeout to trigger (1s idle + 10s check interval)
    // We need to wait at least 1s (idle timeout) + up to 10s (check interval)
    await new Promise(resolve => setTimeout(resolve, 12000))

    // Broker should have shut down
    // Try to make a request - should fail
    try {
      await client.get('test')
      assert.fail('Expected client.get to fail after broker shutdown')
    } catch (err) {
      // Expected - broker should be shut down
      assert.ok(err.message.includes('ECONNREFUSED') || err.message.includes('ENOENT'))
    }

    const elapsed = Date.now() - startTime
    // Verify it took roughly the idle timeout + check interval
    assert.ok(elapsed >= 1000, `Should wait at least idle timeout (${elapsed}ms >= 1000ms)`)
    assert.ok(elapsed < 15000, `Should not wait too long (${elapsed}ms < 15000ms)`)
  })

  it('should NOT shutdown if requests keep coming', async () => {
    const broker = new Broker({
      debug: false,
      idleTimeout: 2000, // 2 second idle timeout
      requireTTL: false
    })

    await broker.start()
    const client = new Client(broker.pipe)

    // Make requests every 500ms for 3 seconds
    // This should keep the broker alive since it's never idle for 2 seconds
    const intervalId = setInterval(async () => {
      try {
        await client.ping()
      } catch {
        // Ignore errors
      }
    }, 500)

    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Stop making requests
    clearInterval(intervalId)

    // Broker should still be alive
    const result = await client.ping()
    assert.strictEqual(result.ok, true, 'Broker should still be alive after active requests')

    // Clean up
    broker.stop()
  })

  it('should NOT shutdown if idleTimeout is not configured', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false
      // No idleTimeout specified
    })

    await broker.start()
    const client = new Client(broker.pipe)

    // Make initial request
    await client.set('test', 'value', 5000)

    // Wait for what would be an idle timeout if it were enabled
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Broker should still be alive
    const result = await client.get('test')
    assert.strictEqual(result.value, 'value', 'Broker should still be alive without idleTimeout')

    // Clean up
    broker.stop()
  })

  it('should reset idle timer on each request', async () => {
    const broker = new Broker({
      debug: false,
      idleTimeout: 2000, // 2 second idle timeout
      requireTTL: false
    })

    await broker.start()
    const client = new Client(broker.pipe)

    // Make a request
    await client.set('test', 'value1', 5000)

    // Wait 1.5 seconds
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Make another request (should reset idle timer)
    await client.set('test', 'value2', 5000)

    // Wait another 1.5 seconds (total 3s from start, but only 1.5s since last request)
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Broker should still be alive because last request was only 1.5s ago
    const result = await client.get('test')
    assert.strictEqual(result.value, 'value2', 'Broker should still be alive - timer was reset')

    // Clean up
    broker.stop()
  })
})
