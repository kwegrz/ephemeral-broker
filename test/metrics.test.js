import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'
import { Metrics } from '../src/metrics.js'

describe('Metrics', () => {
  it('should track operation counts', () => {
    const metrics = new Metrics()

    metrics.recordOperation('get', true)
    metrics.recordOperation('get', true)
    metrics.recordOperation('get', false) // error
    metrics.recordOperation('set', true)

    assert.strictEqual(metrics.operations.get.total, 3, 'Should have 3 get operations')
    assert.strictEqual(metrics.operations.get.errors, 1, 'Should have 1 get error')
    assert.strictEqual(metrics.operations.set.total, 1, 'Should have 1 set operation')
  })

  it('should track compression metrics', () => {
    const metrics = new Metrics()

    metrics.recordCompression(1000, 500) // 50% compression
    metrics.recordCompression(2000, 1000) // 50% compression
    metrics.recordUncompressed()

    assert.strictEqual(metrics.compression.compressed, 2, 'Should have 2 compressed values')
    assert.strictEqual(metrics.compression.uncompressed, 1, 'Should have 1 uncompressed value')
    assert.strictEqual(
      metrics.compression.bytesBeforeCompression,
      3000,
      'Should track bytes before compression'
    )
    assert.strictEqual(
      metrics.compression.bytesAfterCompression,
      1500,
      'Should track bytes after compression'
    )

    const ratio = metrics.getCompressionRatio()
    assert.strictEqual(ratio, 0.5, 'Compression ratio should be 0.5 (50%)')
  })

  it('should track expired items', () => {
    const metrics = new Metrics()

    metrics.recordExpired(5, 2)
    metrics.recordExpired(3, 1)

    assert.strictEqual(metrics.storage.itemsExpired, 8, 'Should have 8 expired items')
    assert.strictEqual(metrics.storage.leasesExpired, 3, 'Should have 3 expired leases')
  })

  it('should generate Prometheus format', () => {
    const metrics = new Metrics()

    metrics.recordOperation('get', true)
    metrics.recordOperation('set', false)
    metrics.recordCompression(1000, 500)

    const output = metrics.toPrometheusFormat()

    assert.ok(
      output.includes('# HELP ephemeral_broker_operations_total'),
      'Should have operations help'
    )
    assert.ok(
      output.includes('# TYPE ephemeral_broker_operations_total counter'),
      'Should have operations type'
    )
    assert.ok(
      output.includes('ephemeral_broker_operations_total{action="get",result="success"} 1'),
      'Should count get success'
    )
    assert.ok(
      output.includes('ephemeral_broker_operations_total{action="set",result="error"} 1'),
      'Should count set error'
    )
    assert.ok(
      output.includes('ephemeral_broker_compression_total{compressed="true"} 1'),
      'Should count compressed values'
    )
  })

  it('should reset all metrics', () => {
    const metrics = new Metrics()

    metrics.recordOperation('get', true)
    metrics.recordCompression(1000, 500)
    metrics.recordExpired(5, 2)

    metrics.reset()

    assert.strictEqual(metrics.operations.get.total, 0, 'Get operations should be reset')
    assert.strictEqual(metrics.compression.compressed, 0, 'Compressed count should be reset')
    assert.strictEqual(metrics.storage.itemsExpired, 0, 'Expired items should be reset')
  })
})

describe('Broker Metrics Integration', () => {
  it('should track operations through broker', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    // Perform various operations
    await client.set('key1', 'value1', 5000)
    await client.get('key1')
    await client.del('key1')
    await client.ping()

    // Check metrics
    assert.strictEqual(broker.metrics.operations.set.total, 1, 'Should track set operations')
    assert.strictEqual(broker.metrics.operations.get.total, 1, 'Should track get operations')
    assert.strictEqual(broker.metrics.operations.del.total, 1, 'Should track del operations')
    assert.strictEqual(broker.metrics.operations.ping.total, 1, 'Should track ping operations')

    broker.stop()
  })

  it('should return metrics in Prometheus format', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    await client.set('test', 'value', 5000)

    const metricsOutput = await client.metrics()

    assert.ok(typeof metricsOutput === 'string', 'Metrics should be a string')
    assert.ok(metricsOutput.includes('# HELP'), 'Should include Prometheus help text')
    assert.ok(metricsOutput.includes('# TYPE'), 'Should include Prometheus type declarations')
    assert.ok(
      metricsOutput.includes('ephemeral_broker_operations_total'),
      'Should include operation metrics'
    )

    broker.stop()
  })

  it('should track compression metrics', async () => {
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

    // Set a large value that will be compressed
    const largeValue = { data: 'x'.repeat(200) }
    await client.set('large', largeValue, 5000)

    // Set a small value that won't be compressed
    const smallValue = { data: 'small' }
    await client.set('small', smallValue, 5000)

    // Check compression metrics
    assert.strictEqual(broker.metrics.compression.compressed, 1, 'Should have 1 compressed value')
    assert.strictEqual(
      broker.metrics.compression.uncompressed,
      1,
      'Should have 1 uncompressed value'
    )
    assert.ok(
      broker.metrics.compression.bytesBeforeCompression > 0,
      'Should track bytes before compression'
    )
    assert.ok(
      broker.metrics.compression.bytesAfterCompression > 0,
      'Should track bytes after compression'
    )

    const ratio = broker.metrics.getCompressionRatio()
    assert.ok(ratio > 0 && ratio < 1, 'Compression ratio should be between 0 and 1')

    broker.stop()
  })

  it('should track errors in operations', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    // Successful operation
    await client.set('key1', 'value1', 5000)

    // Failed operation (key not found)
    try {
      await client.get('nonexistent')
    } catch {
      // Expected error
    }

    assert.strictEqual(broker.metrics.operations.set.total, 1, 'Should have 1 set operation')
    assert.strictEqual(broker.metrics.operations.set.errors, 0, 'Set should have 0 errors')
    assert.strictEqual(broker.metrics.operations.get.total, 1, 'Should have 1 get operation')
    assert.strictEqual(broker.metrics.operations.get.errors, 1, 'Get should have 1 error')

    broker.stop()
  })

  it('should track expired items from sweeper', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    // Set items with very short TTL
    await client.set('temp1', 'value1', 100)
    await client.set('temp2', 'value2', 100)

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150))

    // Manually trigger sweeper
    broker.sweepExpired()

    // Check that expired items were tracked
    assert.ok(broker.metrics.storage.itemsExpired >= 2, 'Should track at least 2 expired items')

    broker.stop()
  })

  it('should include request metrics', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    await client.ping()
    await client.ping()

    const metricsOutput = await client.metrics()

    assert.ok(
      metricsOutput.includes('ephemeral_broker_requests_total'),
      'Should include total requests'
    )
    assert.ok(
      metricsOutput.includes('ephemeral_broker_requests_in_flight'),
      'Should include in-flight requests'
    )
    assert.ok(metricsOutput.includes('ephemeral_broker_draining'), 'Should include draining status')

    broker.stop()
  })

  it('should work when metrics are disabled', async () => {
    const broker = new Broker({ debug: false, requireTTL: false, metrics: false })
    await broker.start()
    const client = new Client(broker.pipe)

    await client.set('key', 'value', 5000)

    // Metrics should still exist but not track anything
    assert.strictEqual(broker.metrics.operations.set.total, 0, 'Should not track when disabled')

    broker.stop()
  })
})
