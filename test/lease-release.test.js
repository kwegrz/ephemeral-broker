import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Lease/Release for Parallel Workers', () => {
  describe('Basic lease functionality', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should lease unique values to different workers for same key', async () => {
      const key = 'test-token'
      const workers = ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5']
      const values = []

      // Each worker leases the same key
      for (const workerId of workers) {
        const value = await client.lease(key, workerId, 60000)
        values.push(value)
      }

      // All values should be unique
      const uniqueValues = new Set(values)
      assert.strictEqual(uniqueValues.size, workers.length, 'All workers should get unique values')

      // Values should be sequential starting from 0
      assert.deepStrictEqual(
        values.sort((a, b) => a - b),
        [0, 1, 2, 3, 4]
      )

      // Cleanup: release all workers
      for (const workerId of workers) {
        await client.release(workerId)
      }
    })

    it('should release a lease and allow new worker to use that value', async () => {
      const key = 'release-test'

      // Use unique worker IDs to avoid conflicts with previous test
      const value1 = await client.lease(key, 'release-worker-1', 60000)
      assert.strictEqual(value1, 0)

      const value2 = await client.lease(key, 'release-worker-2', 60000)
      assert.strictEqual(value2, 1)

      // Release worker 1
      const released = await client.release('release-worker-1')
      assert.strictEqual(released, true)

      // Worker 3 should get value 0 (released by worker-1, lowest available)
      const value3 = await client.lease(key, 'release-worker-3', 60000)
      assert.strictEqual(value3, 0)

      // Worker 4 should get value 2 (next available, since 0 and 1 are taken)
      const value4 = await client.lease(key, 'release-worker-4', 60000)
      assert.strictEqual(value4, 2)

      // Release worker 2 and worker 3
      await client.release('release-worker-2')
      await client.release('release-worker-3')

      // Worker 5 should get value 0 again (lowest available)
      const value5 = await client.lease(key, 'release-worker-5', 60000)
      assert.strictEqual(value5, 0)
    })

    it('should renew lease if worker requests same key again', async () => {
      const key = 'renew-test'

      // Worker gets initial lease
      const value1 = await client.lease(key, 'renew-worker', 100)
      assert.strictEqual(value1, 0)

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50))

      // Request same key again - should renew and return same value
      const value2 = await client.lease(key, 'renew-worker', 60000)
      assert.strictEqual(value2, 0, 'Should return same value on renewal')

      // Verify it's actually renewed by checking it hasn't expired
      await new Promise(resolve => setTimeout(resolve, 100))

      // If it was renewed, another lease should return same value
      const value3 = await client.lease(key, 'renew-worker', 60000)
      assert.strictEqual(value3, 0)

      // Cleanup
      await client.release('renew-worker')
    })

    it('should error if worker tries to lease different key without releasing', async () => {
      // Worker leases first key
      await client.lease('key1', 'greedy-worker', 60000)

      // Try to lease different key without releasing
      await assert.rejects(
        () => client.lease('key2', 'greedy-worker', 60000),
        /worker_already_has_lease/,
        'Should reject when worker tries to lease different key'
      )

      // Cleanup
      await client.release('greedy-worker')
    })
  })

  describe('10 parallel workers - acceptance criteria', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should give 10 workers unique values for same key', async () => {
      const key = 'parallel-key'
      const workerIds = Array.from({ length: 10 }, (_, i) => `worker-${i}`)
      const leases = []

      // All workers lease in parallel
      const promises = workerIds.map(workerId => client.lease(key, workerId, 60000))

      leases.push(...(await Promise.all(promises)))

      // Verify all unique
      const uniqueValues = new Set(leases)
      assert.strictEqual(uniqueValues.size, 10, 'All 10 workers should get unique values')

      // Verify sequential 0-9
      assert.deepStrictEqual(
        leases.sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      )

      // Cleanup
      for (const workerId of workerIds) {
        await client.release(workerId)
      }
    })

    it('should handle rapid lease/release cycles without deadlock', async () => {
      const key = 'rapid-key'
      const iterations = 20

      for (let i = 0; i < iterations; i++) {
        const workerId = `rapid-worker-${i}`

        // Lease
        const value = await client.lease(key, workerId, 60000)
        assert.strictEqual(typeof value, 'number')

        // Immediately release
        const released = await client.release(workerId)
        assert.strictEqual(released, true)
      }

      // All should complete without hanging or errors
      assert.ok(true, 'Completed all rapid cycles without deadlock')
    })
  })

  describe('TTL expiration for leases', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should not count expired leases against uniqueness', async () => {
      const key = 'expire-test'

      // Worker 1 gets value 0 with short TTL
      const value1 = await client.lease(key, 'expire-worker-1', 50)
      assert.strictEqual(value1, 0)

      // Worker 2 gets value 1
      const value2 = await client.lease(key, 'expire-worker-2', 60000)
      assert.strictEqual(value2, 1)

      // Wait for worker 1's lease to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      // Worker 3 should get value 0 (expired lease doesn't count)
      const value3 = await client.lease(key, 'expire-worker-3', 60000)
      assert.strictEqual(value3, 0)

      // Cleanup
      await client.release('expire-worker-2')
      await client.release('expire-worker-3')
    })

    it('should sweep expired leases', async () => {
      const key = 'sweep-test'

      // Create some leases with short TTL
      await client.lease(key, 'sweep-1', 50)
      await client.lease(key, 'sweep-2', 50)
      await client.lease(key, 'sweep-3', 50)

      // Check stats before sweep
      let stats = await client.stats()
      assert.strictEqual(stats.leases, 3)

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100))

      // Trigger sweep manually
      broker.sweepExpired()

      // Check stats after sweep
      stats = await client.stats()
      assert.strictEqual(stats.leases, 0, 'Expired leases should be swept')
    })
  })

  describe('Stats tracking', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should track active lease count in stats', async () => {
      // Start with 0 leases
      let stats = await client.stats()
      assert.strictEqual(stats.leases, 0)

      // Add 3 leases
      await client.lease('stat-key', 'stat-1', 60000)
      await client.lease('stat-key', 'stat-2', 60000)
      await client.lease('stat-key', 'stat-3', 60000)

      stats = await client.stats()
      assert.strictEqual(stats.leases, 3)

      // Release one
      await client.release('stat-2')

      stats = await client.stats()
      assert.strictEqual(stats.leases, 2)

      // Cleanup remaining
      await client.release('stat-1')
      await client.release('stat-3')
    })
  })

  describe('Error handling', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should require key parameter', async () => {
      await assert.rejects(
        () => client.lease('', 'worker-1'),
        /Key is required/,
        'Should reject empty key'
      )
    })

    it('should require workerId parameter', async () => {
      await assert.rejects(
        () => client.lease('key', ''),
        /Worker ID is required/,
        'Should reject empty workerId'
      )
    })

    it('should handle release of non-existent worker gracefully', async () => {
      const released = await client.release('non-existent-worker')
      assert.strictEqual(released, false, 'Should return false for non-existent worker')
    })
  })

  describe('Multiple keys', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false })
    })

    after(() => {
      broker.stop()
    })

    it('should handle leases for different keys independently', async () => {
      // Different workers can lease different keys
      const value1 = await client.lease('key-a', 'worker-a', 60000)
      const value2 = await client.lease('key-b', 'worker-b', 60000)
      const value3 = await client.lease('key-c', 'worker-c', 60000)

      // All should get value 0 (first lease for each key)
      assert.strictEqual(value1, 0)
      assert.strictEqual(value2, 0)
      assert.strictEqual(value3, 0)

      // Multiple workers on same key get different values
      const value4 = await client.lease('key-a', 'worker-a2', 60000)
      assert.strictEqual(value4, 1, 'Second worker on key-a should get value 1')

      // Stats should show 4 active leases
      const stats = await client.stats()
      assert.strictEqual(stats.leases, 4)

      // Cleanup
      await client.release('worker-a')
      await client.release('worker-b')
      await client.release('worker-c')
      await client.release('worker-a2')
    })
  })
})
