import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Chaos Testing - Resilience Under Failure', () => {
  describe('Flood with oversized requests', () => {
    it('should handle flood of oversized requests without crashing', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        maxRequestSize: 10000, // 10KB limit
        maxValueSize: 5000, // 5KB value limit
        compression: false // Disable compression to test raw size limits
      })

      const pipe = await broker.start()
      const client = new Client(pipe, {
        timeout: 2000,
        debug: false,
        allowNoTtl: true,
        compression: false
      })

      // Flood with 50 oversized requests
      const promises = []
      for (let i = 0; i < 50; i++) {
        const bigValue = 'x'.repeat(20000) // 20KB (way over limit)
        promises.push(
          client.set(`key${i}`, bigValue).catch(err => {
            // Expected to fail with too_large
            assert.match(err.message, /too_large/)
            return 'rejected'
          })
        )
      }

      const results = await Promise.all(promises)

      // All should have been rejected
      const rejectedCount = results.filter(r => r === 'rejected').length
      assert.strictEqual(rejectedCount, 50, 'All oversized requests should be rejected')

      // Broker should still be responsive
      await client.set('normal', 'value')
      const value = await client.get('normal')
      assert.strictEqual(value, 'value', 'Broker should still work after flood')

      broker.stop()
    })

    it('should reject malformed JSON without crashing', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      // Manually create bad connection and send garbage
      const net = await import('node:net')
      const socket = net.createConnection(pipe)

      await new Promise(resolve => socket.on('connect', resolve))

      // Send malformed JSON
      socket.write('{ this is not valid json\n')
      socket.write('garbage data here\n')
      socket.write('{unclosed\n')

      await new Promise(resolve => setTimeout(resolve, 100))

      // Broker should still be alive
      const client = new Client(pipe, { debug: false, allowNoTtl: true })
      await client.ping()

      socket.end()
      broker.stop()
    })
  })

  describe('Rapid connect/disconnect cycles', () => {
    it('should handle 100 rapid connect/disconnect cycles', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      for (let i = 0; i < 100; i++) {
        const client = new Client(pipe, { timeout: 1000, debug: false, allowNoTtl: true })
        await client.ping()
        // Client connection closes after each request
      }

      // Broker should still be responsive
      const finalClient = new Client(pipe, { debug: false, allowNoTtl: true })
      await finalClient.ping()

      broker.stop()
    })

    it('should handle rapid connection attempts (connection spam)', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      // Create 50 connections simultaneously
      const promises = []
      for (let i = 0; i < 50; i++) {
        const client = new Client(pipe, { timeout: 2000, debug: false, allowNoTtl: true })
        promises.push(client.ping())
      }

      const results = await Promise.all(promises)

      // All should succeed
      assert.strictEqual(results.length, 50)
      results.forEach(pong => {
        assert.ok(typeof pong === 'number')
      })

      broker.stop()
    })
  })

  describe('Heavy parallel load', () => {
    it('should handle 50 parallel clients hammering broker', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      // 50 clients each making 5 requests = 250 total requests
      const allPromises = []
      for (let i = 0; i < 50; i++) {
        const client = new Client(pipe, { timeout: 5000, debug: false, allowNoTtl: true })
        // Each client makes 5 operations
        for (let j = 0; j < 5; j++) {
          allPromises.push(client.set(`client${i}-key${j}`, `value${j}`))
        }
      }

      // All 250 operations should complete
      const results = await Promise.all(allPromises)
      assert.strictEqual(results.length, 250)

      // Verify data integrity - spot check a value
      const client = new Client(pipe, { timeout: 2000, debug: false, allowNoTtl: true })
      const value = await client.get('client0-key0')
      assert.strictEqual(value, 'value0')

      broker.stop()
    })

    it('should handle mixed operation load under stress', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      const promises = []
      const numClients = 50

      for (let i = 0; i < numClients; i++) {
        const client = new Client(pipe, { timeout: 3000, debug: false, allowNoTtl: true })

        // Mix of operations
        promises.push(client.set(`key${i}`, `value${i}`))
        promises.push(client.get(`key${i}`).catch(() => null)) // May not exist yet
        promises.push(client.list())
        promises.push(client.ping())
        promises.push(client.stats())
      }

      const results = await Promise.allSettled(promises)

      // Most should succeed (some gets may fail if key doesn't exist yet)
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      assert.ok(succeeded > numClients * 3, 'Most operations should succeed')

      broker.stop()
    })
  })

  describe('Lease/release under stress', () => {
    it('should handle 100 workers fighting for 10 leases', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      const promises = []
      for (let i = 0; i < 100; i++) {
        const workerId = `worker-${i}`
        const client = new Client(pipe, { timeout: 3000, debug: false, allowNoTtl: true })

        promises.push(
          (async () => {
            try {
              const value = await client.lease('resource-pool', workerId, 1000)
              assert.ok(value >= 1 && value <= 10, 'Should get value 1-10')

              // Hold for a moment
              await new Promise(resolve => setTimeout(resolve, 10))

              await client.release(workerId)
              return 'success'
            } catch {
              // Some may timeout waiting for a lease
              return 'timeout'
            }
          })()
        )
      }

      const results = await Promise.all(promises)
      const successes = results.filter(r => r === 'success').length

      // With 100 workers fighting for 10 leases, expect at least 10 to succeed
      assert.ok(successes >= 10, `At least 10 should succeed, got ${successes}`)

      broker.stop()
    })
  })

  describe('Memory and resource exhaustion', () => {
    it('should enforce maxItems limit under load', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        maxItems: 100 // Small limit
      })

      const pipe = await broker.start()
      const client = new Client(pipe, { timeout: 2000, debug: false, allowNoTtl: true })

      // Try to add 150 items (50 over limit)
      const promises = []
      for (let i = 0; i < 150; i++) {
        promises.push(
          client.set(`key${i}`, `value${i}`).catch(_err => {
            if (_err.message === 'max_items') {
              return 'rejected'
            }
            throw _err
          })
        )
      }

      const results = await Promise.all(promises)
      const rejected = results.filter(r => r === 'rejected').length

      // At least 50 should be rejected
      assert.ok(rejected >= 50, `Expected ~50 rejections, got ${rejected}`)

      // Broker should still work
      await client.ping()

      broker.stop()
    })
  })

  describe('Error recovery', () => {
    it('should recover from client crashes (unreleased leases)', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      // Worker 1 leases but never releases (simulates crash)
      const client1 = new Client(pipe, { debug: false, allowNoTtl: true })
      const lease1 = await client1.lease('resource', 'worker1', 500) // 500ms TTL
      assert.ok(lease1 >= 0, 'Should get a valid lease')
      const firstLease = lease1

      // Don't release - simulate crash

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 600))

      // Worker 2 should be able to get the lease now
      const client2 = new Client(pipe, { debug: false, allowNoTtl: true })
      const lease2 = await client2.lease('resource', 'worker2', 1000)
      assert.strictEqual(lease2, firstLease, 'Should reuse expired lease')

      await client2.release('worker2')
      broker.stop()
    })
  })

  describe('Broker shutdown under load', () => {
    it('should gracefully shutdown while handling requests', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()

      // Start many concurrent requests
      const promises = []
      for (let i = 0; i < 50; i++) {
        const client = new Client(pipe, { timeout: 3000, debug: false, allowNoTtl: true })
        promises.push(
          client.set(`key${i}`, `value${i}`).catch(() => {
            // Some may fail if broker stops mid-request
            return 'failed'
          })
        )
      }

      // Stop broker while requests are in flight
      setTimeout(() => broker.stop(), 50)

      const results = await Promise.allSettled(promises)

      // Should complete without hanging
      assert.strictEqual(results.length, 50)

      // No need to verify exact success count - just that it didn't hang
    })
  })
})
