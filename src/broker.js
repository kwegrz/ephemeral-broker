import net from 'node:net'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { makePipePath, cleanupPipe } from './pipe-utils.js'

export class Broker {
  constructor(options = {}) {
    this.options = {
      defaultTTL: options.defaultTTL || 30 * 60 * 1000, // 30 min
      debug: options.debug || false,
      maxRequestSize: options.maxRequestSize || 1024 * 1024, // 1MB default
      maxValueSize: options.maxValueSize || 256 * 1024, // 256KB default
      maxItems: options.maxItems !== undefined ? options.maxItems : 10000,
      ...options
    }

    this.pipe = makePipePath(options.pipeId)
    this.store = new Map()
    this.server = null
    this.child = null
    this.sweeperInterval = null
    this.startTime = null
    this.signalHandlers = new Map()
  }

  async start() {
    // Check for stale socket on Unix systems
    if (process.platform !== 'win32' && fs.existsSync(this.pipe)) {
      // Try to connect to see if broker is already running
      const isRunning = await this.checkIfBrokerRunning()

      if (isRunning) {
        throw new Error('Broker already running')
      } else {
        // Socket file exists but broker isn't running - it's stale
        if (this.options.debug) {
          console.log(`[broker] Removing stale socket: ${this.pipe}`)
        }
        fs.unlinkSync(this.pipe)
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer(this.handleConnection.bind(this))

      this.server.once('error', reject)

      this.server.listen(this.pipe, () => {
        if (this.options.debug) {
          console.log(`[broker] Started on: ${this.pipe}`)
        }

        // Record start time for uptime calculation
        this.startTime = Date.now()

        // Export pipe path for child processes
        process.env.EPHEMERAL_PIPE = this.pipe

        // Start TTL sweeper - runs every 30 seconds
        this.startSweeper()

        // Set up graceful shutdown handlers
        this.setupSignalHandlers()

        resolve(this.pipe)
      })
    })
  }

  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM']

    for (const signal of signals) {
      const handler = () => {
        if (this.options.debug) {
          console.log(`[broker] Received ${signal}, shutting down gracefully...`)
        }
        this.stop()
        process.exit(0)
      }

      this.signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }

  async checkIfBrokerRunning() {
    return new Promise(resolve => {
      const client = net.createConnection(this.pipe)

      client.once('connect', () => {
        // Connected successfully - broker is running
        client.end()
        resolve(true)
      })

      client.once('error', () => {
        // Connection failed - broker is not running
        resolve(false)
      })

      // Set timeout in case connection hangs
      client.setTimeout(1000)
      client.once('timeout', () => {
        client.destroy()
        resolve(false)
      })
    })
  }

  handleConnection(socket) {
    let buffer = ''

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')

      // Check request size limit
      if (buffer.length > this.options.maxRequestSize) {
        socket.write(JSON.stringify({ ok: false, error: 'too_large' }) + '\n')
        socket.end()
        return
      }

      // Process complete messages (newline-delimited)
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)

        this.processMessage(line, socket)
      }
    })

    socket.on('error', err => {
      if (this.options.debug) {
        console.log(`[broker] Socket error: ${err.message}`)
      }
    })
  }

  async processMessage(line, socket) {
    let msg
    try {
      msg = JSON.parse(line || '{}')
    } catch {
      socket.write(JSON.stringify({ ok: false, error: 'invalid_json' }) + '\n')
      return
    }

    if (this.options.debug) {
      console.log(`[broker] Request: ${msg.action}`)
    }

    let response
    switch (msg.action) {
    case 'get':
      response = this.handleGet(msg)
      break
    case 'set':
      response = this.handleSet(msg)
      break
    case 'del':
      response = this.handleDel(msg)
      break
    case 'list':
      response = this.handleList()
      break
    case 'ping':
      response = { ok: true, pong: Date.now() }
      break
    case 'stats':
      response = this.handleStats()
      break
    default:
      response = { ok: false, error: 'unknown_action' }
    }

    socket.write(JSON.stringify(response) + '\n')
  }

  handleGet({ key }) {
    const item = this.store.get(key)

    if (!item) {
      return { ok: false, error: 'not_found' }
    }

    // Check if expired
    if (item.expires && item.expires <= Date.now()) {
      this.store.delete(key)
      return { ok: false, error: 'expired' }
    }

    return { ok: true, value: item.value }
  }

  handleSet({ key, value, ttl }) {
    // Check value size limit
    if (value && typeof value === 'string' && value.length > this.options.maxValueSize) {
      return { ok: false, error: 'too_large' }
    }

    // Check serialized size for non-string values
    if (value && typeof value !== 'string') {
      const serialized = JSON.stringify(value)
      if (serialized.length > this.options.maxValueSize) {
        return { ok: false, error: 'too_large' }
      }
    }

    // Check maxItems limit (only if adding a new key)
    if (!this.store.has(key) && this.options.maxItems > 0) {
      // Count non-expired items
      const now = Date.now()
      let activeCount = 0
      for (const [, item] of this.store.entries()) {
        if (!item.expires || item.expires > now) {
          activeCount++
        }
      }

      if (activeCount >= this.options.maxItems) {
        return { ok: false, error: 'max_items' }
      }
    }

    const expires = ttl ? Date.now() + ttl : Date.now() + this.options.defaultTTL

    this.store.set(key, { value, expires })

    if (this.options.debug) {
      console.log(`[broker] Set ${key} with TTL ${ttl || this.options.defaultTTL}ms`)
    }

    return { ok: true }
  }

  handleDel({ key }) {
    this.store.delete(key)
    return { ok: true }
  }

  handleList() {
    const items = {}
    const now = Date.now()

    for (const [key, item] of this.store.entries()) {
      if (!item.expires || item.expires > now) {
        items[key] = {
          expires: item.expires,
          hasValue: item.value !== undefined
        }
      }
    }

    return { ok: true, items }
  }

  handleStats() {
    const now = Date.now()
    let activeItems = 0
    let approximateBytes = 0

    // Count non-expired items and approximate storage size
    for (const [key, item] of this.store.entries()) {
      if (!item.expires || item.expires > now) {
        activeItems++

        // Approximate bytes: key + serialized value + metadata overhead
        approximateBytes += key.length * 2 // UTF-16 char size
        if (item.value !== undefined) {
          const serialized = JSON.stringify(item.value)
          approximateBytes += serialized.length * 2
        }
        approximateBytes += 24 // Approximate overhead for Map entry + expires timestamp
      }
    }

    return {
      ok: true,
      stats: {
        items: activeItems,
        leases: 0, // TODO: implement leases in future
        memory: {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          approximateStoreBytes: approximateBytes
        },
        uptime: this.startTime ? now - this.startTime : 0
      }
    }
  }

  spawn(command, args = []) {
    // Spawn a child process with the pipe available
    this.child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        EPHEMERAL_PIPE: this.pipe
      }
    })

    this.child.on('exit', code => {
      if (this.options.debug) {
        console.log(`[broker] Child exited with code ${code}`)
      }
      this.stop()
      process.exit(code || 0)
    })

    // Handle signals
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        if (this.child) {
          this.child.kill(sig)
        }
        this.stop()
        process.exit(1)
      })
    }

    return this.child
  }

  startSweeper() {
    // Run sweeper every 30 seconds
    this.sweeperInterval = setInterval(() => {
      this.sweepExpired()
    }, 30000)

    // Don't let the interval keep the process alive
    this.sweeperInterval.unref()
  }

  sweepExpired() {
    const now = Date.now()
    let swept = 0

    for (const [key, item] of this.store.entries()) {
      if (item.expires && item.expires <= now) {
        this.store.delete(key)
        swept++
      }
    }

    if (swept > 0 && this.options.debug) {
      console.log(`[broker] Swept ${swept} expired entries`)
    }
  }

  stop() {
    // Remove signal handlers to avoid memory leaks
    for (const [signal, handler] of this.signalHandlers.entries()) {
      process.removeListener(signal, handler)
    }
    this.signalHandlers.clear()

    // Clear sweeper interval
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval)
      this.sweeperInterval = null
    }

    if (this.server) {
      this.server.close()
      this.server = null
    }

    cleanupPipe(this.pipe)
    this.store.clear()

    if (this.options.debug) {
      console.log('[broker] Stopped and cleaned up')
    }
  }
}
