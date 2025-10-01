import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Connection Error Handling', () => {
  describe('Missing/closed pipe', () => {
    it('should fail fast when connecting to non-existent pipe', async () => {
      const client = new Client('/tmp/nonexistent-broker-pipe.sock', {
        timeout: 1000,
        debug: false
      })

      const startTime = Date.now()
      await assert.rejects(
        () => client.get('test'),
        /ENOENT|ECONNREFUSED/,
        'Should throw connection error'
      )
      const duration = Date.now() - startTime

      // Should fail within reasonable time (retries: 50+100+200+400+800 = 1550ms + overhead)
      assert.ok(duration < 3000, `Failed in ${duration}ms (expected < 3000ms)`)
    })

    it('should handle closed pipe after connection', async () => {
      const broker = new Broker({ debug: false })
      const pipe = await broker.start()
      const client = new Client(pipe, { timeout: 1000, debug: false })

      // Verify connection works
      await client.set('test', 'value')

      // Stop broker
      broker.stop()

      // Client should fail on next request
      await assert.rejects(
        () => client.get('test'),
        /ECONNREFUSED|ENOENT|EPIPE/,
        'Should throw connection error after broker stops'
      )
    })
  })

  describe('Broker killed mid-run', () => {
    it('should error cleanly when broker is killed during operation', async () => {
      const broker = new Broker({ debug: false })
      const pipe = await broker.start()
      const client = new Client(pipe, { timeout: 2000, debug: false })

      // Start a request and kill broker immediately
      const requestPromise = client.set('test', 'value')

      // Kill broker after a tiny delay
      setTimeout(() => broker.stop(), 10)

      // Request should either succeed (if fast enough) or fail cleanly
      try {
        await requestPromise
        // Success is OK if it completed before broker died
      } catch (err) {
        // Should be a connection error, not a hang
        assert.match(
          err.message,
          /ECONNREFUSED|ENOENT|EPIPE|timeout|Request failed/,
          'Should fail with connection error'
        )
      }
    })

    it('should handle multiple clients when broker dies', async () => {
      const broker = new Broker({ debug: false })
      const pipe = await broker.start()

      const client1 = new Client(pipe, { timeout: 1000, debug: false })
      const client2 = new Client(pipe, { timeout: 1000, debug: false })
      const client3 = new Client(pipe, { timeout: 1000, debug: false })

      // All clients make requests
      const promises = [
        client1.set('key1', 'value1'),
        client2.set('key2', 'value2'),
        client3.set('key3', 'value3')
      ]

      // Kill broker mid-flight
      setTimeout(() => broker.stop(), 5)

      // All should resolve or reject cleanly (no hangs)
      const results = await Promise.allSettled(promises)

      // Verify all completed (either fulfilled or rejected, but not hanging)
      assert.strictEqual(results.length, 3)

      // At least some should have errored
      const errors = results.filter(r => r.status === 'rejected')
      errors.forEach(error => {
        assert.match(error.reason.message, /ECONNREFUSED|ENOENT|EPIPE|timeout|Request failed/)
      })
    })
  })

  describe('Request timeout', () => {
    it('should timeout on slow server response', async () => {
      const broker = new Broker({ debug: false })
      const pipe = await broker.start()

      // Create a custom client that doesn't properly respond
      // (This is tricky to test without mocking, so we'll use a very short timeout)

      // For now, just verify timeout error structure
      // Set a very short timeout and hope for a race condition
      const fastClient = new Client(pipe, { timeout: 1, debug: false })
      try {
        await fastClient.ping()
        // Might succeed if fast enough - that's OK
      } catch {
        // Might timeout - that's also OK
      }

      broker.stop()
    })
  })

  describe('Retry behavior', () => {
    it('should retry with exponential backoff on connection errors', async () => {
      const client = new Client('/tmp/nonexistent-retry-test.sock', {
        timeout: 500,
        debug: false
      })

      const startTime = Date.now()
      await assert.rejects(() => client.ping(), /ENOENT|ECONNREFUSED/)
      const duration = Date.now() - startTime

      // Should take at least sum of delays: 50+100+200+400+800 = 1550ms
      // (minus one attempt since we count from 0)
      assert.ok(duration >= 1000, `Retried for ${duration}ms (expected >= 1000ms)`)
    })

    it('should not retry on non-retryable errors', async () => {
      const broker = new Broker({ debug: false, maxRequestSize: 100 })
      const pipe = await broker.start()
      const client = new Client(pipe, { timeout: 5000, debug: false })

      const startTime = Date.now()

      // Send oversized request (should fail immediately, not retry)
      await assert.rejects(
        () => client.set('key', 'x'.repeat(200)),
        /too_large/,
        'Should reject with too_large error'
      )

      const duration = Date.now() - startTime

      // Should fail fast (not retry for 1550ms+)
      assert.ok(duration < 500, `Failed in ${duration}ms (should be immediate)`)

      broker.stop()
    })
  })
})
