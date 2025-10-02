import net from 'node:net'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

export class Client {
  constructor(pipe, options = {}) {
    this.pipe = pipe || process.env.EPHEMERAL_PIPE

    if (!this.pipe) {
      throw new Error('No pipe specified and EPHEMERAL_PIPE not set')
    }

    // Parse env vars with fallback to options
    const parseEnvInt = (envVar, defaultValue) => {
      const val = process.env[envVar]
      return val !== undefined ? parseInt(val, 10) : defaultValue
    }

    const parseEnvBool = (envVar, defaultValue) => {
      const val = process.env[envVar]
      if (val === undefined) return defaultValue
      return val === 'true' || val === '1'
    }

    this.options = {
      timeout: options.timeout ?? parseEnvInt('CLIENT_TIMEOUT', 5000),
      debug: options.debug ?? parseEnvBool('CLIENT_DEBUG', false),
      allowNoTtl: options.allowNoTtl ?? parseEnvBool('CLIENT_ALLOW_NO_TTL', false),
      secret: options.secret ?? process.env.CLIENT_SECRET ?? null,
      compression: options.compression ?? parseEnvBool('CLIENT_COMPRESSION', true),
      compressionThreshold:
        options.compressionThreshold ?? parseEnvInt('CLIENT_COMPRESSION_THRESHOLD', 1024),
      ...options
    }
  }

  async request(payload) {
    const retryDelays = [50, 100, 200, 400, 800]
    const totalTimeout = this.options.timeout
    const startTime = Date.now()
    let lastError = null

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      // Check if we've exceeded total timeout
      const elapsed = Date.now() - startTime
      if (elapsed >= totalTimeout) {
        const timeoutErr = new Error(
          `Request timeout after ${elapsed}ms (${attempt} attempts). Last error: ${lastError?.message || 'unknown'}`
        )
        timeoutErr.code = 'ETIMEOUT'
        throw timeoutErr
      }

      try {
        // Calculate remaining time for this attempt
        const remainingTime = totalTimeout - elapsed
        const attemptTimeout = Math.min(this.options.timeout, remainingTime)

        return await this._attemptRequest(payload, attemptTimeout)
      } catch (err) {
        lastError = err

        // Check if error is retryable
        const isRetryable =
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENOENT' ||
          err.code === 'EPIPE' ||
          err.code === 'ETIMEDOUT'

        // If not retryable or we're out of retries, throw the error
        if (!isRetryable || attempt === retryDelays.length) {
          throw lastError
        }

        // Wait before next retry (but check if we have time)
        const delay = retryDelays[attempt]
        const elapsedAfterError = Date.now() - startTime
        if (elapsedAfterError + delay >= totalTimeout) {
          // Not enough time for another retry
          throw lastError
        }

        if (this.options.debug) {
          console.log(
            `[client] Connection failed (${err.code}), retrying in ${delay}ms (attempt ${attempt + 1}/${retryDelays.length})`
          )
        }
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  _attemptRequest(payload, timeout) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.pipe)
      let buffer = ''
      let timer
      const requestTimeout = timeout || this.options.timeout

      socket.on('connect', () => {
        if (this.options.debug) {
          console.log(`[client] Connected to: ${this.pipe}`)
        }

        // Add HMAC if secret is configured
        const message = this.options.secret ? this.addHMAC(payload) : payload

        socket.write(JSON.stringify(message) + '\n')

        timer = setTimeout(() => {
          socket.destroy()
          const err = new Error('Request timeout')
          err.code = 'ETIMEDOUT'
          reject(err)
        }, requestTimeout)
      })

      socket.on('data', chunk => {
        buffer += chunk.toString('utf8')

        const idx = buffer.indexOf('\n')
        if (idx >= 0) {
          clearTimeout(timer)
          const line = buffer.slice(0, idx)
          socket.end()

          try {
            const response = JSON.parse(line)

            if (this.options.debug) {
              console.log('[client] Response:', response)
            }

            if (response.ok) {
              resolve(response)
            } else {
              reject(new Error(response.error || 'Request failed'))
            }
          } catch (err) {
            reject(new Error(`Invalid response: ${err.message}`))
          }
        }
      })

      socket.on('error', err => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  addHMAC(payload) {
    // Compute HMAC for the payload
    const payloadString = JSON.stringify(payload)
    const hmac = crypto
      .createHmac('sha256', this.options.secret)
      .update(payloadString)
      .digest('hex')

    return { ...payload, hmac }
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

  shouldCompress(value) {
    if (!this.options.compression) return false

    const serialized = JSON.stringify(value)
    return serialized.length >= this.options.compressionThreshold
  }

  async get(key) {
    const response = await this.request({ action: 'get', key })

    // Decompress if needed
    if (response.compressed) {
      try {
        return await this.decompressValue(response.value)
      } catch (err) {
        throw new Error(
          `Failed to decompress value for key "${key}": ${err.message}. ` +
            'This may indicate data corruption or a broker version mismatch.'
        )
      }
    }

    return response.value
  }

  async set(key, value, ttl) {
    // Enforce TTL requirement unless allowNoTtl is set
    if (ttl === undefined && !this.options.allowNoTtl) {
      throw new Error(
        'TTL is required for set(). Pass a ttl value or set allowNoTtl: true in client options.'
      )
    }

    // Check if we should compress
    const shouldCompress = this.shouldCompress(value)
    let finalValue = value
    let compressed = false
    let beforeSize = 0
    let afterSize = 0

    if (shouldCompress) {
      try {
        const serialized = JSON.stringify(value)
        beforeSize = serialized.length
        finalValue = await this.compressValue(value)
        afterSize = finalValue.length
        compressed = true
      } catch (err) {
        throw new Error(
          `Failed to compress value for key "${key}": ${err.message}. ` +
            'Hint: Check for circular references or non-serializable values.'
        )
      }
    }

    await this.request({
      action: 'set',
      key,
      value: finalValue,
      ttl,
      compressed,
      beforeSize,
      afterSize
    })
    return true
  }

  async del(key) {
    await this.request({ action: 'del', key })
    return true
  }

  async list() {
    const response = await this.request({ action: 'list' })
    return response.items
  }

  async ping() {
    const response = await this.request({ action: 'ping' })
    return response.pong
  }

  async stats() {
    const response = await this.request({ action: 'stats' })
    return response.stats
  }

  async health() {
    const response = await this.request({ action: 'health' })
    return response
  }

  async metrics() {
    const response = await this.request({ action: 'metrics' })
    return response.metrics
  }

  async lease(key, workerId, ttl) {
    if (!key) {
      throw new Error('Key is required for lease()')
    }
    if (!workerId) {
      throw new Error('Worker ID is required for lease()')
    }

    const response = await this.request({ action: 'lease', key, workerId, ttl })
    return response.value
  }

  async release(workerId) {
    if (!workerId) {
      throw new Error('Worker ID is required for release()')
    }

    const response = await this.request({ action: 'release', workerId })
    return response.released
  }
}
