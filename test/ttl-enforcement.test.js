import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('TTL Enforcement', () => {
  let broker
  let pipe

  before(async () => {
    broker = new Broker({ debug: false, requireTTL: false })
    pipe = await broker.start()
  })

  after(() => {
    broker.stop()
  })

  it('should reject set() without TTL by default', async () => {
    const client = new Client(pipe, { debug: false })

    await assert.rejects(
      () => client.set('key', 'value'),
      /TTL is required/,
      'Should throw error when TTL is not provided'
    )
  })

  it('should accept set() with TTL', async () => {
    const client = new Client(pipe, { debug: false })

    // Should not throw
    await client.set('key', 'value', 5000)

    // Verify it was set
    const value = await client.get('key')
    assert.strictEqual(value, 'value')
  })

  it('should accept set() without TTL when allowNoTtl is true', async () => {
    const client = new Client(pipe, { debug: false, allowNoTtl: true })

    // Should not throw
    await client.set('immortal', 'value')

    // Verify it was set
    const value = await client.get('immortal')
    assert.strictEqual(value, 'value')
  })

  it('should accept set() with TTL = 0 (zero is a valid TTL)', async () => {
    const client = new Client(pipe, { debug: false })

    // TTL = 0 is valid (though it will use default TTL on server)
    await client.set('zero-ttl', 'value', 0)

    // Verify it was set
    const value = await client.get('zero-ttl')
    assert.strictEqual(value, 'value')
  })

  it('should work with various valid TTL values', async () => {
    const client = new Client(pipe, { debug: false })

    // Short TTL
    await client.set('short', 'value', 100)
    assert.strictEqual(await client.get('short'), 'value')

    // Medium TTL
    await client.set('medium', 'value', 60000)
    assert.strictEqual(await client.get('medium'), 'value')

    // Long TTL
    await client.set('long', 'value', 3600000)
    assert.strictEqual(await client.get('long'), 'value')
  })

  it('should provide helpful error message', async () => {
    const client = new Client(pipe, { debug: false })

    try {
      await client.set('key', 'value')
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.ok(
        err.message.includes('TTL is required'),
        'Error message should mention TTL requirement'
      )
      assert.ok(
        err.message.includes('allowNoTtl'),
        'Error message should mention allowNoTtl option'
      )
    }
  })

  it('should not affect clients with allowNoTtl', async () => {
    const strictClient = new Client(pipe, { debug: false })
    const lenientClient = new Client(pipe, { debug: false, allowNoTtl: true })

    // Strict client requires TTL
    await assert.rejects(() => strictClient.set('key1', 'value'))

    // Lenient client doesn't require TTL
    await lenientClient.set('key2', 'value')
    assert.strictEqual(await lenientClient.get('key2'), 'value')

    // Strict client can still use TTL
    await strictClient.set('key3', 'value', 5000)
    assert.strictEqual(await strictClient.get('key3'), 'value')
  })
})
