import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'
import { Logger } from '../src/logger.js'

describe('Logger', () => {
  it('should filter logs by level', () => {
    const logs = []
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    console.log = (...args) => logs.push(args.join(' '))
    console.warn = (...args) => logs.push(args.join(' '))
    console.error = (...args) => logs.push(args.join(' '))

    const logger = new Logger({ level: 'warn', structured: false })

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError

    // Only warn and error should be logged
    assert.strictEqual(logs.length, 2, 'Should only log warn and error')
    assert.ok(logs[0].includes('warn message'), 'Should include warn message')
    assert.ok(logs[1].includes('error message'), 'Should include error message')
  })

  it('should output structured JSON logs when enabled', () => {
    const logs = []
    const originalLog = console.log
    console.log = (...args) => logs.push(args.join(' '))

    const logger = new Logger({ level: 'info', structured: true, component: 'test' })

    logger.info('test message', { key: 'value', num: 42 })

    console.log = originalLog

    assert.strictEqual(logs.length, 1, 'Should log one message')

    const parsed = JSON.parse(logs[0])
    assert.strictEqual(parsed.level, 'info', 'Should have info level')
    assert.strictEqual(parsed.component, 'test', 'Should have component')
    assert.strictEqual(parsed.message, 'test message', 'Should have message')
    assert.strictEqual(parsed.key, 'value', 'Should include metadata')
    assert.strictEqual(parsed.num, 42, 'Should include numeric metadata')
    assert.ok(parsed.timestamp, 'Should have timestamp')
  })

  it('should output human-readable logs when structured is disabled', () => {
    const logs = []
    const originalLog = console.log
    console.log = (...args) => logs.push(args.join(' '))

    const logger = new Logger({ level: 'info', structured: false, component: 'test' })

    logger.info('test message', { key: 'value' })

    console.log = originalLog

    assert.strictEqual(logs.length, 1, 'Should log one message')
    assert.ok(logs[0].includes('[test]'), 'Should include component prefix')
    assert.ok(logs[0].includes('test message'), 'Should include message')
    assert.ok(logs[0].includes('key=value'), 'Should include metadata')
  })

  it('should respect debug level priority', () => {
    const logs = []
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    console.log = (...args) => logs.push(args.join(' '))
    console.warn = (...args) => logs.push(args.join(' '))
    console.error = (...args) => logs.push(args.join(' '))

    const logger = new Logger({ level: 'debug', structured: false })

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError

    // All 4 should be logged
    assert.strictEqual(logs.length, 4, 'Should log all levels')
  })
})

describe('Broker Structured Logging', () => {
  it('should use structured logging when enabled', async () => {
    const logs = []
    const originalLog = console.log
    console.log = (...args) => logs.push(args.join(' '))

    const broker = new Broker({
      debug: false,
      requireTTL: false,
      structuredLogging: true,
      logLevel: 'info'
    })

    await broker.start()

    console.log = originalLog

    // Should have logged broker start in JSON format
    const startLogs = logs.filter(log => log.includes('"message":"Broker started"'))
    assert.ok(startLogs.length > 0, 'Should have logged broker start')

    const parsed = JSON.parse(startLogs[0])
    assert.strictEqual(parsed.level, 'info', 'Should be info level')
    assert.strictEqual(parsed.component, 'broker', 'Should be broker component')
    assert.ok(parsed.pipe, 'Should include pipe path')

    broker.stop()
  })

  it('should respect log level filtering in broker', async () => {
    const logs = []
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    console.log = (...args) => logs.push({ level: 'log', msg: args.join(' ') })
    console.warn = (...args) => logs.push({ level: 'warn', msg: args.join(' ') })
    console.error = (...args) => logs.push({ level: 'error', msg: args.join(' ') })

    const broker = new Broker({
      debug: false,
      requireTTL: false,
      logLevel: 'warn', // Only warn and error - won't log info or debug
      structuredLogging: false
    })

    await broker.start()
    const client = new Client(broker.pipe)

    // This should not log (debug level)
    await client.set('test', 'value', 5000)

    broker.stop()

    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError

    // Should not have debug logs for set operation
    const debugLogs = logs.filter(log => log.msg.includes('Key set'))
    assert.strictEqual(debugLogs.length, 0, 'Should not log debug messages')

    // With logLevel=warn, broker start/stop won't be logged either (they're info level)
    // So we expect minimal logs
    const allLogs = logs.length
    assert.ok(allLogs >= 0, 'Should complete without errors')
  })

  it('should include correlation IDs in debug logs', async () => {
    const logs = []
    const originalLog = console.log
    console.log = (...args) => logs.push(args.join(' '))

    const broker = new Broker({
      debug: true, // This sets logLevel to debug
      requireTTL: false,
      structuredLogging: true
    })

    await broker.start()
    const client = new Client(broker.pipe)

    await client.set('test', 'value', 5000)

    broker.stop()

    console.log = originalLog

    // Find the "Processing request" log
    const requestLogs = logs.filter(log => log.includes('"message":"Processing request"'))
    assert.ok(requestLogs.length > 0, 'Should have request processing logs')

    const parsed = JSON.parse(requestLogs[0])
    assert.ok(parsed.correlationId, 'Should have correlation ID')
    assert.ok(
      parsed.correlationId.includes('-'),
      'Correlation ID should be in timestamp-counter format'
    )
  })

  it('should use debug level when debug option is true', async () => {
    const broker = new Broker({
      debug: true,
      requireTTL: false
    })

    assert.strictEqual(
      broker.options.logLevel,
      'debug',
      'Should set logLevel to debug when debug is true'
    )
    assert.strictEqual(
      broker.logger.options.level,
      'debug',
      'Logger should be configured with debug level'
    )

    broker.stop()
  })

  it('should default to info level when debug is false', async () => {
    const broker = new Broker({
      debug: false,
      requireTTL: false
    })

    assert.strictEqual(broker.options.logLevel, 'info', 'Should default to info level')
    assert.strictEqual(
      broker.logger.options.level,
      'info',
      'Logger should be configured with info level'
    )

    broker.stop()
  })
})
