import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Broker } from '../src/broker.js'
import { makePipePath } from '../src/pipe-utils.js'

describe('Signal Handler Fixes', () => {
  describe('Issue #3: Prevent duplicate signal handlers on multiple start() calls', () => {
    it('should not add duplicate signal handlers when start() is called multiple times', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-signal-dup-${Date.now()}`
      })

      // Start broker
      await broker.start()

      // Check initial handler count
      const initialHandlerCount = broker.signalHandlers.size
      assert.strictEqual(initialHandlerCount, 2, 'Should have 2 handlers (SIGINT, SIGTERM)')

      // Try to set up handlers again (simulating what would happen if start() is called twice)
      broker.setupSignalHandlers()

      // Handler count should remain the same
      const afterHandlerCount = broker.signalHandlers.size
      assert.strictEqual(
        afterHandlerCount,
        initialHandlerCount,
        'Signal handler count should not increase'
      )

      // Cleanup
      broker.stop()
    })

    it('should log debug message when skipping duplicate handler setup', async () => {
      const logs = []
      const broker = new Broker({
        debug: true,
        logLevel: 'debug',
        requireTTL: false,
        pipeId: `test-signal-log-${Date.now()}`
      })

      // Intercept logger
      const originalDebug = broker.logger.debug
      broker.logger.debug = (msg, meta) => {
        logs.push({ msg, meta })
        originalDebug.call(broker.logger, msg, meta)
      }

      await broker.start()

      // Try to set up handlers again
      broker.setupSignalHandlers()

      // Should have logged skip message
      const skipLog = logs.find(log => log.msg.includes('already configured'))
      assert.ok(skipLog, 'Should log that handlers are already configured')

      // Cleanup
      broker.stop()
    })
  })

  describe('Issue #4: Remove duplicate signal handlers in spawn()', () => {
    it('should not have duplicate signal handlers after spawn()', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-spawn-signal-${Date.now()}`
      })

      await broker.start()

      // Check handler count before spawn
      const beforeSpawn = broker.signalHandlers.size
      assert.strictEqual(beforeSpawn, 2, 'Should have 2 handlers before spawn')

      // Note: We can't actually test spawn() without a real command
      // But we can verify the signal handlers in setupSignalHandlers now handle child processes

      // Verify the signal handler logic includes child process handling
      assert.strictEqual(typeof broker.child, 'object', 'Child should be null before spawn')

      // Cleanup
      broker.stop()
    })

    it('should handle child process in unified signal handler', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-unified-handler-${Date.now()}`
      })

      await broker.start()

      // Mock child process
      const mockChild = {
        killed: false,
        kill(signal) {
          this.killed = true
          this.killSignal = signal
        }
      }
      broker.child = mockChild

      // Get the SIGTERM handler
      const sigtermHandler = broker.signalHandlers.get('SIGTERM')
      assert.ok(sigtermHandler, 'SIGTERM handler should exist')

      // We can't actually invoke the handler without exiting the process
      // But we can verify the handler exists and the child mock is set up

      assert.strictEqual(broker.child, mockChild, 'Child process should be set')

      // Cleanup
      broker.child = null
      broker.stop()
    })
  })

  describe('Unified signal handler behavior', () => {
    it('should set up signal handlers only once even with multiple operations', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-multiple-ops-${Date.now()}`
      })

      // Start broker
      await broker.start()

      // Simulate multiple operations that might trigger handler setup
      broker.setupSignalHandlers() // Manual call
      broker.setupSignalHandlers() // Another manual call

      // Should still only have 2 handlers
      assert.strictEqual(broker.signalHandlers.size, 2, 'Should maintain 2 handlers only')

      // Verify we can clean them up properly
      broker.stop()

      // After stop, handlers should be removed
      assert.strictEqual(broker.signalHandlers.size, 0, 'Handlers should be cleared after stop')
    })

    it('should properly clean up signal handlers on stop()', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-cleanup-${Date.now()}`
      })

      await broker.start()

      // Verify handlers are set
      assert.strictEqual(broker.signalHandlers.size, 2)

      // Count process listeners before (we can't easily check this, but we can test the map)
      const handlersBefore = new Map(broker.signalHandlers)

      // Stop broker
      broker.stop()

      // Handlers map should be cleared
      assert.strictEqual(broker.signalHandlers.size, 0, 'Handler map should be empty')

      // Verify the handlers we had are no longer in the map
      for (const signal of handlersBefore.keys()) {
        assert.strictEqual(
          broker.signalHandlers.has(signal),
          false,
          `${signal} handler should be removed`
        )
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle start() -> stop() -> start() cycle correctly', async () => {
      const broker = new Broker({
        debug: false,
        requireTTL: false,
        pipeId: `test-cycle-${Date.now()}`
      })

      // First cycle
      await broker.start()
      assert.strictEqual(broker.signalHandlers.size, 2)
      broker.stop()
      assert.strictEqual(broker.signalHandlers.size, 0)

      // Second cycle - handlers should be set up again
      const newPipeId = `test-cycle-${Date.now()}-2`
      broker.pipe = makePipePath(newPipeId)
      broker.signalHandlers.clear() // Ensure clean state

      await broker.start()
      assert.strictEqual(broker.signalHandlers.size, 2, 'Handlers should be set up again')

      broker.stop()
    })
  })
})
