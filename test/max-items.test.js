import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Max Items Limit', () => {
  describe('Basic maxItems enforcement', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false, requireTTL: false, maxItems: 10 })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should accept items up to maxItems limit', async () => {
      // Add 10 items (at the limit)
      for (let i = 0; i < 10; i++) {
        await client.set(`key${i}`, `value${i}`)
      }

      // Verify all were set
      for (let i = 0; i < 10; i++) {
        const value = await client.get(`key${i}`)
        assert.strictEqual(value, `value${i}`)
      }
    })

    it('should reject 11th item with max_items error', async () => {
      // Try to add 11th item
      await assert.rejects(
        () => client.set('key10', 'value10'),
        /max_items/,
        'Should reject with max_items error'
      )
    })

    it('should allow updates to existing keys', async () => {
      // Update existing key (should not count against limit)
      await client.set('key0', 'updated_value')

      const value = await client.get('key0')
      assert.strictEqual(value, 'updated_value')
    })

    it('should allow new items after deletion', async () => {
      // Delete an item
      await client.del('key1')

      // Now we should be able to add a new item
      await client.set('new_key', 'new_value')

      const value = await client.get('new_key')
      assert.strictEqual(value, 'new_value')
    })
  })

  describe('Expired items do not count against limit', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false, requireTTL: false, maxItems: 5 })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should not count expired items against limit', async () => {
      // Add 5 items with short TTL
      for (let i = 0; i < 5; i++) {
        await client.set(`temp${i}`, `value${i}`, 50)
      }

      // Wait for them to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should be able to add new items (expired ones don't count)
      for (let i = 0; i < 5; i++) {
        await client.set(`fresh${i}`, `value${i}`)
      }

      // Verify fresh items are accessible
      const value = await client.get('fresh0')
      assert.strictEqual(value, 'value0')
    })
  })

  describe('maxItems = 0 disables limit', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false, requireTTL: false, maxItems: 0 })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should allow unlimited items when maxItems = 0', async () => {
      // Add many items (more than any reasonable limit)
      for (let i = 0; i < 100; i++) {
        await client.set(`key${i}`, `value${i}`)
      }

      // Verify they're all accessible
      const value0 = await client.get('key0')
      const value99 = await client.get('key99')
      assert.strictEqual(value0, 'value0')
      assert.strictEqual(value99, 'value99')
    })
  })

  describe('Default maxItems limit', () => {
    it('should default to 10000 items', async () => {
      const broker = new Broker({ debug: false, requireTTL: false })
      const pipe = await broker.start()
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      // Verify default limit is set
      assert.strictEqual(broker.options.maxItems, 10000)

      // Add many items (but less than 10000)
      for (let i = 0; i < 100; i++) {
        await client.set(`key${i}`, `value${i}`)
      }

      // Should work fine
      const value = await client.get('key50')
      assert.strictEqual(value, 'value50')

      broker.stop()
    })
  })

  describe('Stats reflect active items correctly', () => {
    let broker
    let client

    before(async () => {
      broker = new Broker({ debug: false, requireTTL: false, maxItems: 10 })
      const pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should show correct item count at limit', async () => {
      // Add items up to limit
      for (let i = 0; i < 10; i++) {
        await client.set(`item${i}`, `value${i}`)
      }

      const stats = await client.stats()
      assert.strictEqual(stats.items, 10)
    })

    it('should show reduced count after deletion', async () => {
      await client.del('item0')
      await client.del('item1')

      const stats = await client.stats()
      assert.strictEqual(stats.items, 8)
    })
  })
})
