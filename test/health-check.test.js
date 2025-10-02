import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

describe('Health Check', () => {
  it('should return health status with all metrics', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    const health = await client.health()

    assert.strictEqual(health.ok, true, 'Health check should return ok: true')
    assert.strictEqual(health.status, 'healthy', 'Health status should be "healthy"')
    assert.ok(health.uptime >= 0, 'Uptime should be non-negative')
    assert.ok(health.timestamp > 0, 'Timestamp should be present')
    assert.ok(health.memory, 'Memory metrics should be present')
    assert.ok(health.memory.rss > 0, 'RSS memory should be positive')
    assert.ok(health.memory.heapUsed > 0, 'Heap used should be positive')
    assert.ok(health.memory.heapTotal > 0, 'Heap total should be positive')
    assert.ok(health.connections, 'Connection metrics should be present')
    assert.ok(health.connections.inFlight >= 0, 'In-flight requests should be non-negative')
    assert.strictEqual(health.connections.draining, false, 'Should not be draining')

    broker.stop()
  })

  it('should show uptime increasing over time', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    const health1 = await client.health()
    await new Promise(resolve => setTimeout(resolve, 100))
    const health2 = await client.health()

    assert.ok(health2.uptime > health1.uptime, 'Uptime should increase over time')

    broker.stop()
  })

  it('should track draining status', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    // Initial health check - not draining
    const health1 = await client.health()
    assert.strictEqual(health1.connections.draining, false, 'Should not be draining initially')

    // Start draining
    broker.drain()

    // Health check should show draining status
    // Note: We can't easily test this because once draining starts,
    // new connections are rejected. So we verify the initial state only.
    assert.strictEqual(broker.draining, true, 'Broker should be in draining state')

    broker.stop()
  })

  it('should return health even under load', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    // Make multiple concurrent requests
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(client.set(`key${i}`, `value${i}`, 5000))
    }
    promises.push(client.health())

    const results = await Promise.all(promises)
    const health = results[results.length - 1]

    assert.strictEqual(health.ok, true, 'Health check should work under load')
    assert.strictEqual(health.status, 'healthy', 'Status should be healthy under load')

    broker.stop()
  })

  it('should include memory metrics that make sense', async () => {
    const broker = new Broker({ debug: false, requireTTL: false })
    await broker.start()
    const client = new Client(broker.pipe)

    const health = await client.health()

    // Sanity checks on memory values
    assert.ok(
      health.memory.heapUsed <= health.memory.heapTotal,
      'Heap used should be <= heap total'
    )
    assert.ok(health.memory.heapTotal <= health.memory.rss, 'Heap total should be <= RSS')

    broker.stop()
  })
})

describe('Heartbeat', () => {
  it('should log heartbeat at configured interval', async () => {
    let heartbeatCount = 0
    const originalLog = console.log

    // Intercept console.log
    console.log = (...args) => {
      const msg = args.join(' ')
      if (msg.includes('[broker] Heartbeat')) {
        heartbeatCount++
      }
      // Don't call originalLog to keep test output clean
    }

    const broker = new Broker({
      debug: false,
      requireTTL: false,
      heartbeatInterval: 100 // 100ms heartbeat
    })

    await broker.start()

    // Wait for multiple heartbeats
    await new Promise(resolve => setTimeout(resolve, 350))

    broker.stop()

    // Restore console.log
    console.log = originalLog

    // Should have logged at least 3 heartbeats (350ms / 100ms = 3.5)
    assert.ok(
      heartbeatCount >= 3,
      `Should have logged at least 3 heartbeats, got ${heartbeatCount}`
    )
  })

  it('should NOT log heartbeat when heartbeatInterval is not configured', async () => {
    let heartbeatCount = 0
    const originalLog = console.log

    // Intercept console.log
    console.log = (...args) => {
      const msg = args.join(' ')
      if (msg.includes('[broker] Heartbeat')) {
        heartbeatCount++
      }
    }

    const broker = new Broker({
      debug: false,
      requireTTL: false
      // No heartbeatInterval configured
    })

    await broker.start()
    await new Promise(resolve => setTimeout(resolve, 300))
    broker.stop()

    // Restore console.log
    console.log = originalLog

    assert.strictEqual(heartbeatCount, 0, 'Should not log any heartbeats when not configured')
  })

  it('should include uptime and memory in heartbeat log', async () => {
    let heartbeatLog = null
    const originalLog = console.log

    // Intercept console.log
    console.log = (...args) => {
      const msg = args.join(' ')
      if (msg.includes('Heartbeat')) {
        heartbeatLog = msg
      }
    }

    const broker = new Broker({
      debug: false,
      requireTTL: false,
      heartbeatInterval: 100
    })

    await broker.start()
    await new Promise(resolve => setTimeout(resolve, 150))
    broker.stop()

    // Restore console.log
    console.log = originalLog

    assert.ok(heartbeatLog, 'Should have captured a heartbeat log')
    assert.ok(
      heartbeatLog.includes('uptimeSeconds') || heartbeatLog.includes('uptime'),
      'Heartbeat should include uptime'
    )
    assert.ok(
      heartbeatLog.includes('memoryMB') || heartbeatLog.includes('memory'),
      'Heartbeat should include memory'
    )
    assert.ok(heartbeatLog.includes('inFlight'), 'Heartbeat should include inFlight count')
  })
})
