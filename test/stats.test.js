import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Stats Endpoint', () => {
  let broker
  let client

  before(async () => {
    broker = new Broker({ debug: false, requireTTL: false })
    const pipe = await broker.start()
    client = new Client(pipe, { debug: false, allowNoTtl: true })
  })

  after(() => {
    broker.stop()
  })

  it('should return stats with zero items initially', async () => {
    const stats = await client.stats()

    assert.ok(stats, 'Stats should be returned')
    assert.strictEqual(stats.items, 0, 'Should have 0 items initially')
    assert.strictEqual(stats.leases, 0, 'Should have 0 leases')
    assert.ok(stats.memory, 'Should have memory stats')
    assert.ok(typeof stats.memory.rss === 'number', 'RSS should be a number')
    assert.ok(typeof stats.memory.heapUsed === 'number', 'heapUsed should be a number')
    assert.ok(
      typeof stats.memory.approximateStoreBytes === 'number',
      'approximateStoreBytes should be a number'
    )
    assert.ok(typeof stats.uptime === 'number', 'Uptime should be a number')
    assert.ok(stats.uptime >= 0, 'Uptime should be non-negative')
  })

  it('should count items correctly after setting 5 keys', async () => {
    // Set 5 keys
    await client.set('key1', 'value1')
    await client.set('key2', 'value2')
    await client.set('key3', 'value3')
    await client.set('key4', 'value4')
    await client.set('key5', 'value5')

    const stats = await client.stats()

    assert.strictEqual(stats.items, 5, 'Should have exactly 5 items')
  })

  it('should not count expired items', async () => {
    // Add an expired item
    await client.set('expired', 'value', 50)

    // Wait for it to expire
    await new Promise(resolve => setTimeout(resolve, 100))

    const stats = await client.stats()

    // Should still be 5 (not 6) because expired item shouldn't be counted
    assert.strictEqual(stats.items, 5, 'Expired items should not be counted')
  })

  it('should update item count after deletion', async () => {
    await client.del('key1')
    await client.del('key2')

    const stats = await client.stats()

    assert.strictEqual(stats.items, 3, 'Should have 3 items after deleting 2')
  })

  it('should approximate storage bytes', async () => {
    const statsBefore = await client.stats()
    const bytesBefore = statsBefore.memory.approximateStoreBytes

    // Add a large value
    await client.set('large', 'x'.repeat(1000))

    const statsAfter = await client.stats()
    const bytesAfter = statsAfter.memory.approximateStoreBytes

    assert.ok(
      bytesAfter > bytesBefore,
      'Approximate bytes should increase after adding large value'
    )
    assert.strictEqual(statsAfter.items, 4, 'Should now have 4 items')
  })

  it('should track uptime', async () => {
    const stats1 = await client.stats()
    const uptime1 = stats1.uptime

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100))

    const stats2 = await client.stats()
    const uptime2 = stats2.uptime

    assert.ok(uptime2 > uptime1, 'Uptime should increase over time')
    assert.ok(uptime2 - uptime1 >= 100, 'Uptime delta should be at least 100ms')
  })

  it('should include memory stats', async () => {
    const stats = await client.stats()

    assert.ok(stats.memory.rss > 0, 'RSS should be positive')
    assert.ok(stats.memory.heapUsed > 0, 'Heap used should be positive')
    assert.ok(stats.memory.rss >= stats.memory.heapUsed, 'RSS should be >= heap used')
  })

  it('should work with empty store after clearing all items', async () => {
    // Delete all remaining items
    await client.del('key3')
    await client.del('key4')
    await client.del('key5')
    await client.del('large')

    const stats = await client.stats()

    assert.strictEqual(stats.items, 0, 'Should have 0 items after clearing all')
    assert.ok(
      stats.memory.approximateStoreBytes >= 0,
      'Approximate bytes should be non-negative even with empty store'
    )
  })
})
