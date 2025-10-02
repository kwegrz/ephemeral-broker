import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Graceful Drain Period', () => {
  describe('Drain behavior', () => {
    let broker
    let client
    let pipe

    before(async () => {
      broker = new Broker({ debug: false, pipeId: `test-drain-${Date.now()}` })
      pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should start with draining = false and inFlightRequests = 0', async () => {
      assert.strictEqual(broker.draining, false)
      assert.strictEqual(broker.inFlightRequests, 0)
    })

    it('should track in-flight requests correctly', async () => {
      assert.strictEqual(broker.inFlightRequests, 0)

      // Start a request
      const promise = client.set('test', 'value')

      // Give it a moment to increment counter
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have incremented (or may have already completed)
      // Just verify it doesn't error and completes
      await promise

      // After completion, should be back to 0
      assert.strictEqual(broker.inFlightRequests, 0)
    })

    it('should set draining flag when drain() is called', async () => {
      assert.strictEqual(broker.draining, false)

      // Call drain
      const drainPromise = broker.drain(100)

      // Should be draining now
      assert.strictEqual(broker.draining, true)

      await drainPromise

      // Should still be draining (doesn't reset)
      assert.strictEqual(broker.draining, true)
    })
  })

  describe('Reject connections during drain', () => {
    let broker
    let client
    let pipe

    before(async () => {
      broker = new Broker({ debug: false, pipeId: `test-drain-reject-${Date.now()}` })
      pipe = await broker.start()
      client = new Client(pipe, { debug: false, allowNoTtl: true })
    })

    after(() => {
      broker.stop()
    })

    it('should reject new connections during drain', async () => {
      // Make first connection work
      await client.set('key1', 'value1')

      // Start draining
      broker.draining = true

      // New connection should be rejected
      const client2 = new Client(pipe, { debug: false, allowNoTtl: true })

      await assert.rejects(
        () => client2.set('key2', 'value2'),
        /draining/,
        'Should reject with draining error'
      )
    })
  })

  describe('Wait for in-flight requests', () => {
    let broker

    before(async () => {
      broker = new Broker({ debug: false, pipeId: `test-drain-wait-${Date.now()}` })
      await broker.start()
    })

    after(() => {
      broker.stop()
    })

    it('should wait for in-flight requests to complete', async () => {
      // Simulate in-flight requests
      broker.inFlightRequests = 2

      const drainStart = Date.now()

      // Start drain in background
      const drainPromise = broker.drain(1000)

      // Simulate requests completing after 100ms
      setTimeout(() => {
        broker.inFlightRequests = 1
      }, 50)

      setTimeout(() => {
        broker.inFlightRequests = 0
      }, 100)

      await drainPromise

      const drainDuration = Date.now() - drainStart

      // Should have waited ~100ms for requests to complete
      assert.ok(drainDuration >= 100, 'Should wait for requests to complete')
      assert.ok(drainDuration < 500, 'Should not wait full timeout')
    })

    it('should timeout if requests take too long', async () => {
      // Reset broker state
      broker.draining = false
      broker.inFlightRequests = 5

      const drainStart = Date.now()

      // Start drain with short timeout
      await broker.drain(200)

      const drainDuration = Date.now() - drainStart

      // Should have timed out after ~200ms
      assert.ok(drainDuration >= 200, 'Should wait for timeout')
      assert.ok(drainDuration < 400, 'Should not wait significantly longer than timeout')

      // Requests should still be "in flight" (we didn't complete them)
      assert.strictEqual(broker.inFlightRequests, 5)
    })
  })
})
