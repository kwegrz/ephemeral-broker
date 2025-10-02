import net from 'node:net'
import fs from 'node:fs'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { makePipePath, cleanupPipe } from './pipe-utils.js'
import { Logger } from './logger.js'
import { Metrics } from './metrics.js'

export class Broker {
  constructor(options = {}) {
    this.options = {
      defaultTTL: options.defaultTTL || 30 * 60 * 1000, // 30 min
      debug: options.debug || false,
      maxRequestSize: options.maxRequestSize || 1024 * 1024, // 1MB default
      maxValueSize: options.maxValueSize || 256 * 1024, // 256KB default
      maxItems: options.maxItems !== undefined ? options.maxItems : 10000,
      secret: options.secret || null, // Optional HMAC secret
      requireTTL: options.requireTTL !== undefined ? options.requireTTL : true, // Require TTL by default
      idleTimeout: options.idleTimeout || null, // Idle timeout in ms (disabled by default)
      heartbeatInterval: options.heartbeatInterval || null, // Heartbeat interval in ms (disabled by default)
      logLevel: options.logLevel || (options.debug ? 'debug' : 'info'), // Log level (debug, info, warn, error)
      structuredLogging: options.structuredLogging || false, // JSON structured logs
      compression: options.compression !== undefined ? options.compression : true, // Enable compression by default
      compressionThreshold: options.compressionThreshold || 1024, // Compress values larger than 1KB
      ...options
    }

    // Initialize logger
    this.logger = new Logger({
      level: this.options.logLevel,
      structured: this.options.structuredLogging,
      component: 'broker'
    })

    // Initialize metrics
    this.metrics = new Metrics({
      enabled: this.options.metrics !== undefined ? this.options.metrics : true
    })

    this.pipe = makePipePath(options.pipeId)
    this.store = new Map()
    this.leases = new Map() // workerId -> { key, value, expires }
    this.server = null
    this.child = null
    this.sweeperInterval = null
    this.idleCheckInterval = null
    this.heartbeatInterval = null
    this.startTime = null
    this.lastActivity = null
    this.signalHandlers = new Map()
    this.draining = false
    this.inFlightRequests = 0
    this.requestCounter = 0 // For generating correlation IDs
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
        this.logger.debug('Removing stale socket', { pipe: this.pipe })
        fs.unlinkSync(this.pipe)
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer(this.handleConnection.bind(this))

      this.server.once('error', reject)

      this.server.listen(this.pipe, () => {
        // Set restrictive permissions on Unix domain socket (owner-only)
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(this.pipe, 0o700)
          } catch (err) {
            this.logger.warn('Failed to set socket permissions', { error: err.message })
          }
        }

        this.logger.info('Broker started', { pipe: this.pipe })

        // Record start time for uptime calculation
        this.startTime = Date.now()
        this.lastActivity = Date.now()

        // Export pipe path for child processes
        process.env.EPHEMERAL_PIPE = this.pipe

        // Start TTL sweeper - runs every 30 seconds
        this.startSweeper()

        // Start idle checker if idleTimeout is configured
        if (this.options.idleTimeout) {
          this.startIdleChecker()
        }

        // Start heartbeat if heartbeatInterval is configured
        if (this.options.heartbeatInterval) {
          this.startHeartbeat()
        }

        // Set up graceful shutdown handlers
        this.setupSignalHandlers()

        resolve(this.pipe)
      })
    })
  }

  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM']

    for (const signal of signals) {
      const handler = async () => {
        this.logger.info('Received shutdown signal', { signal })
        await this.drain()
        this.stop()
        process.exit(0)
      }

      this.signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }

  async drain(timeout = 5000) {
    if (this.draining) {
      return
    }

    this.draining = true

    this.logger.info('Draining connections', { inFlight: this.inFlightRequests })

    const startTime = Date.now()

    // Wait for in-flight requests to complete or timeout
    while (this.inFlightRequests > 0) {
      if (Date.now() - startTime > timeout) {
        this.logger.warn('Drain timeout exceeded', { inFlight: this.inFlightRequests, timeout })
        break
      }
      // Wait 10ms before checking again
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    if (this.inFlightRequests === 0) {
      this.logger.info('Drain complete')
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
    // Reject new connections during drain
    if (this.draining) {
      socket.write(JSON.stringify({ ok: false, error: 'draining' }) + '\n')
      socket.end()
      return
    }

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
      this.logger.debug('Socket error', { error: err.message })
    })
  }

  async processMessage(line, socket) {
    // Track in-flight request
    this.inFlightRequests++

    // Update last activity timestamp
    this.lastActivity = Date.now()

    let msg
    try {
      msg = JSON.parse(line || '{}')
    } catch {
      socket.write(JSON.stringify({ ok: false, error: 'invalid_json' }) + '\n')
      this.inFlightRequests--
      return
    }

    // Validate HMAC if secret is configured
    if (this.options.secret) {
      const isValid = this.validateHMAC(msg)
      if (!isValid) {
        socket.write(JSON.stringify({ ok: false, error: 'auth_failed' }) + '\n')
        this.inFlightRequests--
        return
      }
    }

    // Generate correlation ID for request tracking
    const correlationId = `${Date.now()}-${++this.requestCounter}`

    this.logger.debug('Processing request', { action: msg.action, correlationId })

    // Record request metrics
    this.metrics.recordRequest(this.inFlightRequests, this.draining)

    let response
    switch (msg.action) {
    case 'get':
      response = this.handleGet(msg)
      this.metrics.recordOperation('get', response.ok)
      break
    case 'set':
      response = await this.handleSet(msg)
      this.metrics.recordOperation('set', response.ok)
      break
    case 'del':
      response = this.handleDel(msg)
      this.metrics.recordOperation('del', response.ok)
      break
    case 'list':
      response = this.handleList()
      this.metrics.recordOperation('list', response.ok)
      break
    case 'ping':
      response = { ok: true, pong: Date.now() }
      this.metrics.recordOperation('ping', response.ok)
      break
    case 'stats':
      response = this.handleStats()
      this.metrics.recordOperation('stats', response.ok)
      break
    case 'health':
      response = this.handleHealth()
      this.metrics.recordOperation('health', response.ok)
      break
    case 'metrics':
      response = this.handleMetrics()
      break
    case 'lease':
      response = this.handleLease(msg)
      this.metrics.recordOperation('lease', response.ok)
      break
    case 'release':
      response = this.handleRelease(msg)
      this.metrics.recordOperation('release', response.ok)
      break
    default:
      response = { ok: false, error: 'unknown_action' }
    }

    socket.write(JSON.stringify(response) + '\n')

    // Decrement in-flight request counter
    this.inFlightRequests--
  }

  validateHMAC(msg) {
    if (!msg.hmac) {
      return false
    }

    // Extract HMAC from message
    const clientHMAC = msg.hmac

    // Create payload without HMAC field
    const payload = { ...msg }
    delete payload.hmac

    // Compute expected HMAC
    const payloadString = JSON.stringify(payload)
    const expectedHMAC = crypto
      .createHmac('sha256', this.options.secret)
      .update(payloadString)
      .digest('hex')

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(clientHMAC, 'hex'), Buffer.from(expectedHMAC, 'hex'))
  }

  async compressValue(value) {
    return new Promise((resolve, reject) => {
      const serialized = JSON.stringify(value)
      const buffer = Buffer.from(serialized, 'utf8')

      zlib.gzip(buffer, (err, compressed) => {
        if (err) return reject(err)
        resolve(compressed.toString('base64'))
      })
    })
  }

  async decompressValue(compressed) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(compressed, 'base64')

      zlib.gunzip(buffer, (err, decompressed) => {
        if (err) return reject(err)
        const serialized = decompressed.toString('utf8')
        resolve(JSON.parse(serialized))
      })
    })
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

    return { ok: true, value: item.value, compressed: item.compressed }
  }

  async handleSet({ key, value, ttl, compressed, beforeSize, afterSize }) {
    // Validate TTL if requireTTL is enabled
    if (this.options.requireTTL) {
      if (ttl === undefined || ttl === null) {
        return { ok: false, error: 'ttl_required' }
      }
      if (ttl <= 0) {
        return { ok: false, error: 'invalid_ttl' }
      }
    }

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

    // Record compression metrics
    if (compressed && beforeSize && afterSize) {
      this.metrics.recordCompression(beforeSize, afterSize)
    } else if (!compressed) {
      this.metrics.recordUncompressed()
    }

    const expires = ttl ? Date.now() + ttl : Date.now() + this.options.defaultTTL

    // Store with compression flag
    this.store.set(key, { value, expires, compressed: compressed || false })

    this.logger.debug('Key set', {
      key,
      ttl: ttl || this.options.defaultTTL,
      compressed: compressed || false
    })

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

  handleLease({ key, workerId, ttl }) {
    if (!key || !workerId) {
      return { ok: false, error: 'key_and_worker_required' }
    }

    const now = Date.now()

    // Clean up expired leases first
    for (const [wid, lease] of this.leases.entries()) {
      if (lease.expires && lease.expires <= now) {
        this.leases.delete(wid)
      }
    }

    // Check if worker already has a lease
    const existingLease = this.leases.get(workerId)
    if (existingLease) {
      // If it's for the same key and still valid, renew it
      if (existingLease.key === key) {
        const expires = ttl ? now + ttl : now + this.options.defaultTTL
        existingLease.expires = expires
        return { ok: true, value: existingLease.value }
      } else {
        // Worker trying to lease different key without releasing
        return { ok: false, error: 'worker_already_has_lease' }
      }
    }

    // Get all leased values for this key
    const leasedValues = new Set()
    for (const lease of this.leases.values()) {
      if (lease.key === key && (!lease.expires || lease.expires > now)) {
        leasedValues.add(lease.value)
      }
    }

    // Generate unique value for this worker
    let value = 0
    while (leasedValues.has(value)) {
      value++
    }

    const expires = ttl ? now + ttl : now + this.options.defaultTTL

    this.leases.set(workerId, { key, value, expires })

    this.logger.debug('Lease granted', {
      key,
      value,
      workerId,
      ttl: ttl || this.options.defaultTTL
    })

    return { ok: true, value }
  }

  handleRelease({ workerId }) {
    if (!workerId) {
      return { ok: false, error: 'worker_required' }
    }

    const existed = this.leases.delete(workerId)

    if (existed) {
      this.logger.debug('Lease released', { workerId })
    }

    return { ok: true, released: existed }
  }

  handleHealth() {
    const now = Date.now()
    const mem = process.memoryUsage()

    return {
      ok: true,
      status: 'healthy',
      uptime: this.startTime ? now - this.startTime : 0,
      timestamp: now,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal
      },
      connections: {
        inFlight: this.inFlightRequests,
        draining: this.draining
      }
    }
  }

  handleMetrics() {
    return {
      ok: true,
      metrics: this.metrics.toPrometheusFormat(),
      format: 'prometheus'
    }
  }

  handleStats() {
    const now = Date.now()
    let activeItems = 0
    let activeLeases = 0
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

    // Count non-expired leases
    for (const lease of this.leases.values()) {
      if (!lease.expires || lease.expires > now) {
        activeLeases++
      }
    }

    return {
      ok: true,
      stats: {
        items: activeItems,
        leases: activeLeases,
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
      this.logger.info('Child process exited', { code })
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

  startIdleChecker() {
    // Check every 10 seconds for idle timeout
    this.idleCheckInterval = setInterval(() => {
      this.checkIdleTimeout()
    }, 10000)

    // Don't let the interval keep the process alive
    this.idleCheckInterval.unref()
  }

  startHeartbeat() {
    // Log heartbeat at configured interval
    this.heartbeatInterval = setInterval(() => {
      this.logHeartbeat()
    }, this.options.heartbeatInterval)

    // Don't let the interval keep the process alive
    this.heartbeatInterval.unref()
  }

  logHeartbeat() {
    const health = this.handleHealth()
    this.logger.info('Heartbeat', {
      uptimeSeconds: Math.floor(health.uptime / 1000),
      memoryMB: Math.floor(health.memory.heapUsed / 1024 / 1024),
      inFlight: health.connections.inFlight
    })
  }

  checkIdleTimeout() {
    if (!this.options.idleTimeout || !this.lastActivity) {
      return
    }

    const now = Date.now()
    const idleTime = now - this.lastActivity

    if (idleTime >= this.options.idleTimeout) {
      this.logger.info('Idle timeout exceeded, shutting down', {
        idleTime,
        timeout: this.options.idleTimeout
      })
      this.shutdownDueToIdle()
    }
  }

  async shutdownDueToIdle() {
    await this.drain()
    this.stop()
    process.exit(0)
  }

  sweepExpired() {
    const now = Date.now()
    let sweptItems = 0
    let sweptLeases = 0

    // Sweep expired items
    for (const [key, item] of this.store.entries()) {
      if (item.expires && item.expires <= now) {
        this.store.delete(key)
        sweptItems++
      }
    }

    // Sweep expired leases
    for (const [workerId, lease] of this.leases.entries()) {
      if (lease.expires && lease.expires <= now) {
        this.leases.delete(workerId)
        sweptLeases++
      }
    }

    if (sweptItems > 0 || sweptLeases > 0) {
      this.logger.debug('Swept expired entries', { items: sweptItems, leases: sweptLeases })
      this.metrics.recordExpired(sweptItems, sweptLeases)
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

    // Clear idle check interval
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.server) {
      this.server.close()
      this.server = null
    }

    cleanupPipe(this.pipe)
    this.store.clear()

    this.logger.info('Broker stopped and cleaned up')
  }
}
