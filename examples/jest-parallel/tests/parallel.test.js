import { Client } from 'ephemeral-broker'

describe('Parallel Test Coordination', () => {
  let client

  beforeAll(async () => {
    client = new Client(process.env.EPHEMERAL_PIPE, {
      secret: process.env.EPHEMERAL_SECRET || 'test-secret',
      allowNoTtl: true
    })

    // Verify broker is accessible
    await client.ping()
  })

  describe('Database Connection Pool', () => {
    it('should lease unique DB connections for parallel workers', async () => {
      const workerId = `worker-${process.pid}-${Date.now()}`

      // Lease a DB connection from pool
      const connId = await client.lease('db-connections', workerId, 60000)

      console.log(`Worker ${workerId} got DB connection ${connId}`)

      // Simulate DB query
      await new Promise(resolve => setTimeout(resolve, 50))

      // Store query result
      await client.set(`query-${connId}`, {
        workerId,
        connId,
        query: 'SELECT * FROM users',
        rows: 42
      })

      // Release connection
      await client.release(workerId)

      expect(connId).toBeGreaterThanOrEqual(1)
      expect(connId).toBeLessThanOrEqual(10)
    })
  })

  describe('API Test Coordination', () => {
    it('should share API keys across parallel tests', async () => {
      // Try to get existing API key
      let apiKey
      try {
        apiKey = await client.get('api-key')
      } catch {
        // First worker generates the key
        apiKey = `key_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`
        await client.set('api-key', apiKey)
        console.log('Generated API key:', apiKey)
      }

      console.log('Using API key:', apiKey)

      // All workers use the same key
      expect(apiKey).toMatch(/^key_/)
    })

    it('should coordinate rate-limited API calls', async () => {
      const workerId = `worker-${process.pid}`

      // Atomic counter for rate limiting
      const callNum = await client.lease('api-calls', workerId, 5000)

      console.log(`Worker ${workerId} - API call #${callNum}`)

      // Simulate rate-limited API call
      await new Promise(resolve => setTimeout(resolve, 10))

      await client.release(workerId)

      expect(callNum).toBeGreaterThan(0)
    })
  })

  describe('Test Data Sharing', () => {
    it('should share expensive test fixtures', async () => {
      let testData
      try {
        testData = await client.get('test-fixture')
      } catch {
        // First worker loads the fixture
        testData = {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Charlie' }
          ],
          config: {
            timeout: 5000,
            retries: 3
          }
        }
        await client.set('test-fixture', testData)
        console.log('Loaded test fixture')
      }

      // All workers use the same fixture
      expect(testData.users).toHaveLength(3)
      expect(testData.config.timeout).toBe(5000)
    })

    it('should isolate worker-specific state', async () => {
      const workerId = `worker-${process.pid}-${Math.random().toString(36).substr(2)}`

      // Each worker has isolated state
      await client.set(`state-${workerId}`, {
        workerId,
        isolated: true,
        data: Math.random()
      })

      const state = await client.get(`state-${workerId}`)

      expect(state.workerId).toBe(workerId)
      expect(state.isolated).toBe(true)
    })
  })

  describe('Parallel Worker Coordination', () => {
    it('should coordinate parallel data processing', async () => {
      const workerId = `processor-${process.pid}`

      // Lease a chunk to process
      const chunkId = await client.lease('data-chunks', workerId, 60000)

      console.log(`Worker ${workerId} processing chunk ${chunkId}`)

      // Simulate processing
      const result = {
        chunkId,
        processed: true,
        items: chunkId * 100,
        timestamp: Date.now()
      }

      await client.set(`chunk-result-${chunkId}`, result)

      // Release chunk
      await client.release(workerId)

      expect(result.items).toBe(chunkId * 100)
    })

    it('should handle worker failures gracefully', async () => {
      const workerId = `fragile-${process.pid}`

      // Lease with TTL so it auto-releases if worker crashes
      const resourceId = await client.lease('critical-resources', workerId, 1000)

      expect(resourceId).toBeDefined()

      // Simulate work (TTL will auto-release if we "crash")
      await new Promise(resolve => setTimeout(resolve, 50))

      // Explicit release
      const released = await client.release(workerId)
      expect(released).toBe(true)
    })
  })
})
