import net from 'node:net'

export class Client {
  constructor(pipe, options = {}) {
    this.pipe = pipe || process.env.EPHEMERAL_PIPE

    if (!this.pipe) {
      throw new Error('No pipe specified and EPHEMERAL_PIPE not set')
    }

    this.options = {
      timeout: options.timeout || 5000,
      debug: options.debug || false,
      ...options
    }
  }

  async request(payload) {
    const retryDelays = [50, 100, 200, 400, 800]
    let lastError = null

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        return await this._attemptRequest(payload)
      } catch (err) {
        lastError = err

        // Check if error is retryable
        const isRetryable =
          err.code === 'ECONNREFUSED' || err.code === 'ENOENT' || err.code === 'EPIPE'

        // If not retryable or we're out of retries, throw the error
        if (!isRetryable || attempt === retryDelays.length) {
          throw lastError
        }

        // Wait before next retry
        const delay = retryDelays[attempt]
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

  _attemptRequest(payload) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.pipe)
      let buffer = ''
      let timer

      socket.on('connect', () => {
        if (this.options.debug) {
          console.log(`[client] Connected to: ${this.pipe}`)
        }

        socket.write(JSON.stringify(payload) + '\n')

        timer = setTimeout(() => {
          socket.destroy()
          reject(new Error('Request timeout'))
        }, this.options.timeout)
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

  async get(key) {
    const response = await this.request({ action: 'get', key })
    return response.value
  }

  async set(key, value, ttl) {
    await this.request({ action: 'set', key, value, ttl })
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
}
