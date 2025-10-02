import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

describe('Message Compression', () => {
  it('should compress large values automatically', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 100 // Small threshold for testing
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 100
    })

    // Create a large value that exceeds the threshold
    const largeValue = { data: 'x'.repeat(200) }

    await client.set('large', largeValue, 5000)

    // Verify it's stored compressed
    const storedItem = broker.store.get('large')
    assert.ok(storedItem.compressed, 'Value should be marked as compressed')

    // Verify we can retrieve and decompress it
    const retrieved = await client.get('large')
    assert.deepStrictEqual(retrieved, largeValue, 'Retrieved value should match original')

    broker.stop()
  })

  it('should NOT compress small values', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 1024
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 1024
    })

    // Small value below threshold
    const smallValue = { data: 'small' }

    await client.set('small', smallValue, 5000)

    // Verify it's NOT compressed
    const storedItem = broker.store.get('small')
    assert.strictEqual(storedItem.compressed, false, 'Small value should not be compressed')

    // Verify we can retrieve it normally
    const retrieved = await client.get('small')
    assert.deepStrictEqual(retrieved, smallValue, 'Retrieved value should match original')

    broker.stop()
  })

  it('should work when compression is disabled', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: false
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: false
    })

    const largeValue = { data: 'x'.repeat(2000) }

    await client.set('nocompress', largeValue, 5000)

    // Verify it's NOT compressed
    const storedItem = broker.store.get('nocompress')
    assert.strictEqual(storedItem.compressed, false, 'Value should not be compressed when disabled')

    // Verify we can retrieve it
    const retrieved = await client.get('nocompress')
    assert.deepStrictEqual(retrieved, largeValue, 'Retrieved value should match original')

    broker.stop()
  })

  it('should handle mixed compressed and uncompressed values', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 100
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 100
    })

    // Set small value (not compressed)
    const smallValue = { data: 'small' }
    await client.set('small', smallValue, 5000)

    // Set large value (compressed)
    const largeValue = { data: 'x'.repeat(200) }
    await client.set('large', largeValue, 5000)

    // Retrieve both
    const retrievedSmall = await client.get('small')
    const retrievedLarge = await client.get('large')

    assert.deepStrictEqual(retrievedSmall, smallValue, 'Small value should be retrieved correctly')
    assert.deepStrictEqual(retrievedLarge, largeValue, 'Large value should be retrieved correctly')

    broker.stop()
  })

  it('should reduce memory usage for large payloads', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 1024
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 1024
    })

    // Create a highly compressible large value
    const largeValue = { data: 'aaaa'.repeat(1000) } // 4000 chars of repeated data
    const uncompressedSize = JSON.stringify(largeValue).length

    await client.set('compressible', largeValue, 5000)

    // Get stored item
    const storedItem = broker.store.get('compressible')
    const compressedSize = storedItem.value.length

    // Compressed size should be significantly smaller
    assert.ok(
      compressedSize < uncompressedSize * 0.5,
      'Compressed size should be less than 50% of original'
    )
    assert.ok(storedItem.compressed, 'Should be marked as compressed')

    // Verify retrieval works
    const retrieved = await client.get('compressible')
    assert.deepStrictEqual(retrieved, largeValue, 'Retrieved value should match original')

    broker.stop()
  })

  it('should respect custom compression threshold', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 500
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 500
    })

    // Value just below threshold
    const belowThreshold = { data: 'x'.repeat(400) }
    await client.set('below', belowThreshold, 5000)

    // Value above threshold
    const aboveThreshold = { data: 'x'.repeat(600) }
    await client.set('above', aboveThreshold, 5000)

    // Check compression status
    assert.strictEqual(
      broker.store.get('below').compressed,
      false,
      'Below threshold should not be compressed'
    )
    assert.strictEqual(
      broker.store.get('above').compressed,
      true,
      'Above threshold should be compressed'
    )

    broker.stop()
  })

  it('should handle complex objects with compression', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false,
      compression: true,
      compressionThreshold: 100
    })

    await broker.start()
    const client = new Client(broker.pipe, {
      compression: true,
      compressionThreshold: 100
    })

    // Complex nested object
    const complexValue = {
      users: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        active: true
      }))
    }

    await client.set('complex', complexValue, 5000)

    // Verify it's compressed
    assert.ok(broker.store.get('complex').compressed, 'Complex object should be compressed')

    // Verify retrieval maintains structure
    const retrieved = await client.get('complex')
    assert.deepStrictEqual(retrieved, complexValue, 'Complex object should be retrieved correctly')
    assert.strictEqual(retrieved.users.length, 50, 'Array length should be preserved')
    assert.strictEqual(retrieved.users[0].name, 'User 0', 'Nested properties should be preserved')

    broker.stop()
  })
})
