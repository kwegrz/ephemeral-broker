import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Require TTL by default', () => {
  describe('With requireTTL: true (default)', () => {
    let broker
    let pipe

    before(async () => {
      broker = new Broker({
        debug: false,
        pipeId: `test-require-ttl-${Date.now()}`
        // requireTTL is true by default
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should reject set() without TTL', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await assert.rejects(
        () => client.set('key', 'value'),
        /ttl_required/,
        'Should reject set without TTL when requireTTL is true'
      )
    })

    it('should reject set() with TTL = 0', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await assert.rejects(
        () => client.set('key', 'value', 0),
        /invalid_ttl/,
        'Should reject set with TTL = 0'
      )
    })

    it('should reject set() with negative TTL', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await assert.rejects(
        () => client.set('key', 'value', -1000),
        /invalid_ttl/,
        'Should reject set with negative TTL'
      )
    })

    it('should accept set() with valid positive TTL', async () => {
      const client = new Client(pipe, { debug: false })

      await client.set('key', 'value', 5000)
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })

    it('should accept set() with very small positive TTL', async () => {
      const client = new Client(pipe, { debug: false })

      await client.set('key2', 'value2', 1)
      const value = await client.get('key2')

      assert.strictEqual(value, 'value2')
    })

    it('should provide clear error message for missing TTL', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      try {
        await client.set('key', 'value')
        assert.fail('Should have thrown ttl_required error')
      } catch (err) {
        assert.strictEqual(err.message, 'ttl_required')
      }
    })

    it('should provide clear error message for invalid TTL', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      try {
        await client.set('key', 'value', 0)
        assert.fail('Should have thrown invalid_ttl error')
      } catch (err) {
        assert.strictEqual(err.message, 'invalid_ttl')
      }
    })
  })

  describe('With requireTTL: false', () => {
    let broker
    let pipe

    before(async () => {
      broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-no-require-ttl-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should allow set() without TTL when requireTTL is false', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await client.set('key', 'value')
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })

    it('should still use defaultTTL when TTL is not provided', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await client.set('key2', 'value2')

      // Check that item exists in store with expiration
      const item = broker.store.get('key2')
      assert.ok(item, 'Item should exist in store')
      assert.ok(item.expires, 'Item should have expiration time')
      assert.ok(item.expires > Date.now(), 'Item should not be expired')
    })

    it('should allow set() with explicit TTL', async () => {
      const client = new Client(pipe, { debug: false })

      await client.set('key3', 'value3', 5000)
      const value = await client.get('key3')

      assert.strictEqual(value, 'value3')
    })

    it('should accept TTL = 0 when requireTTL is false (uses defaultTTL)', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      // When requireTTL is false and ttl is 0, it should use defaultTTL
      await client.set('key4', 'value4', 0)

      // This should use defaultTTL since ttl is 0 (falsy)
      const item = broker.store.get('key4')
      assert.ok(item.expires > Date.now(), 'Should use defaultTTL')
    })
  })

  describe('Client-side TTL enforcement', () => {
    let broker
    let pipe

    before(async () => {
      broker = new Broker({
        debug: false,
        requireTTL: false, // Broker doesn't require TTL
        pipeId: `test-client-ttl-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should require TTL on client side by default (allowNoTtl: false)', async () => {
      const client = new Client(pipe, { debug: false })
      // Default: allowNoTtl is false

      await assert.rejects(
        () => client.set('key', 'value'),
        /TTL is required/,
        'Client should enforce TTL requirement'
      )
    })

    it('should allow client to bypass TTL check with allowNoTtl: true', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await client.set('key', 'value')
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })
  })

  describe('Broker option validation', () => {
    it('should default requireTTL to true', () => {
      const broker = new Broker({ pipeId: 'test-default' })
      assert.strictEqual(broker.options.requireTTL, true)
      broker.stop()
    })

    it('should respect requireTTL: false', () => {
      const broker = new Broker({ pipeId: 'test-false', requireTTL: false })
      assert.strictEqual(broker.options.requireTTL, false)
      broker.stop()
    })

    it('should respect requireTTL: true explicitly', () => {
      const broker = new Broker({ pipeId: 'test-true', requireTTL: true })
      assert.strictEqual(broker.options.requireTTL, true)
      broker.stop()
    })
  })
})
