import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('HMAC Authentication', () => {
  describe('With authentication enabled', () => {
    let broker
    let pipe
    const secret = 'test-secret-key-12345'

    before(async () => {
      broker = new Broker({
        debug: false,
        secret,
        requireTTL: false,
        pipeId: `test-hmac-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should accept requests with valid HMAC', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true, secret })

      // Should work with valid HMAC
      await client.set('test-key', 'test-value')
      const value = await client.get('test-key')

      assert.strictEqual(value, 'test-value')
    })

    it('should reject requests without HMAC', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })
      // No secret = no HMAC

      await assert.rejects(
        () => client.set('key', 'value'),
        /auth_failed/,
        'Should reject request without HMAC'
      )
    })

    it('should reject requests with invalid HMAC', async () => {
      const client = new Client(pipe, {
        debug: false,
        allowNoTtl: true,
        secret: 'wrong-secret'
      })

      await assert.rejects(
        () => client.set('key', 'value'),
        /auth_failed/,
        'Should reject request with invalid HMAC'
      )
    })

    it('should work with all operations when authenticated', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true, secret })

      // Set
      await client.set('key1', 'value1')

      // Get
      const value = await client.get('key1')
      assert.strictEqual(value, 'value1')

      // Del
      await client.del('key1')

      // List
      await client.set('key2', 'value2')
      const items = await client.list()
      assert.ok('key2' in items)

      // Ping
      const pong = await client.ping()
      assert.strictEqual(typeof pong, 'number')

      // Stats
      const stats = await client.stats()
      assert.strictEqual(typeof stats.items, 'number')

      // Lease
      const leaseValue = await client.lease('lease-key', 'worker-1')
      assert.strictEqual(typeof leaseValue, 'number')

      // Release
      const released = await client.release('worker-1')
      assert.strictEqual(released, true)
    })
  })

  describe('Without authentication (secret not configured)', () => {
    let broker
    let pipe

    before(async () => {
      broker = new Broker({
        debug: false,
        requireTTL: false,
        // No secret
        pipeId: `test-no-auth-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should work without HMAC when auth is not configured', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })
      // No secret on broker or client

      await client.set('key', 'value')
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })

    it('should work even if client sends HMAC (broker ignores it)', async () => {
      const client = new Client(pipe, {
        debug: false,
        allowNoTtl: true,
        secret: 'some-secret'
      })
      // Client has secret but broker doesn't - should still work

      await client.set('key', 'value')
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })
  })

  describe('HMAC with environment variable', () => {
    let broker
    let pipe
    const secret = 'env-secret-12345'

    before(async () => {
      // Set environment variable
      process.env.EPHEMERAL_SECRET = secret

      broker = new Broker({
        debug: false,
        requireTTL: false,
        secret, // Broker still needs explicit secret
        pipeId: `test-env-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
      delete process.env.EPHEMERAL_SECRET
    })

    it('should use EPHEMERAL_SECRET environment variable', async () => {
      // Client will read from env var
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      await client.set('key', 'value')
      const value = await client.get('key')

      assert.strictEqual(value, 'value')
    })
  })

  describe('HMAC error messages', () => {
    let broker
    let pipe

    before(async () => {
      broker = new Broker({
        debug: false,
        requireTTL: false,
        secret: 'test-secret',
        pipeId: `test-errors-${Date.now()}`
      })
      pipe = await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should provide clear auth_failed error', async () => {
      const client = new Client(pipe, { debug: false, allowNoTtl: true })

      try {
        await client.set('key', 'value')
        assert.fail('Should have thrown auth_failed error')
      } catch (err) {
        assert.strictEqual(err.message, 'auth_failed')
      }
    })
  })
})
