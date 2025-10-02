# Jest + Ephemeral Broker Example

This example shows how to use ephemeral-broker for coordinating parallel Jest tests.

## Use Cases

- **Database Connection Pooling**: Unique connections for parallel workers
- **API Key Sharing**: Share credentials across test suites
- **Rate Limiting**: Coordinate external API calls
- **Test Fixtures**: Share expensive setup data
- **Data Processing**: Coordinate parallel chunk processing

## Setup

```bash
npm install
```

## Run Tests

```bash
npm test
```

This will:

1. Start broker in `globalSetup`
2. Run tests with 5 parallel workers
3. Each worker coordinates via broker
4. Stop broker in `globalTeardown`

## How It Works

### 1. Global Setup (setup.js)

```javascript
import { Broker } from 'ephemeral-broker'

export default async function globalSetup() {
  const broker = new Broker({ requireTTL: false })
  await broker.start()
  global.__BROKER__ = broker
}
```

### 2. Global Teardown (teardown.js)

```javascript
export default async function globalTeardown() {
  if (global.__BROKER__) {
    global.__BROKER__.stop()
  }
}
```

### 3. Test Setup

```javascript
let client

beforeAll(async () => {
  client = new Client(process.env.EPHEMERAL_PIPE)
  await client.ping()
})
```

### 4. Connection Pooling

```javascript
const connId = await client.lease('db-connections', workerId, 60000)
// Use connection
await client.release(workerId)
```

### 5. Shared API Keys

```javascript
let apiKey = await client.get('api-key').catch(async () => {
  const key = generateApiKey()
  await client.set('api-key', key)
  return key
})
```

## Best Practices

1. **Use `beforeAll` for client setup**: Initialize once per test file
2. **Set TTLs on leases**: Auto-release if worker crashes
3. **Release in `afterEach`**: Clean up after each test
4. **Unique worker IDs**: Use `process.pid` or random IDs

## Common Patterns

### Database Connection Pool

```javascript
describe('DB tests', () => {
  let conn

  beforeEach(async () => {
    const workerId = `worker-${process.pid}`
    const connId = await client.lease('db-pool', workerId, 60000)
    conn = getConnection(connId)
  })

  afterEach(async () => {
    const workerId = `worker-${process.pid}`
    await client.release(workerId)
  })

  it('should query database', async () => {
    const result = await conn.query('SELECT * FROM users')
    expect(result.rows).toBeDefined()
  })
})
```

### Shared Test Setup

```javascript
beforeAll(async () => {
  let setupDone = await client.get('setup-complete').catch(() => false)
  if (!setupDone) {
    await runExpensiveSetup()
    await client.set('setup-complete', true, 3600000)
  }
})
```

### Rate Limiting

```javascript
it('should respect API rate limits', async () => {
  const workerId = `worker-${process.pid}`
  const callNum = await client.lease('api-rate-limit', workerId)

  // Make rate-limited call
  await api.call()

  await client.release(workerId)
})
```

### Parallel Data Processing

```javascript
it('should process data chunks in parallel', async () => {
  const workerId = `processor-${process.pid}`
  const chunkId = await client.lease('chunks', workerId, 60000)

  const data = loadChunk(chunkId)
  const result = processData(data)

  await client.set(`result-${chunkId}`, result)
  await client.release(workerId)
})
```

## Jest Configuration

### jest.config.js

```javascript
export default {
  maxWorkers: 5,
  globalSetup: './setup.js',
  globalTeardown: './teardown.js',
  testEnvironment: 'node'
}
```

### Enable ESM Support

Add to package.json:

```json
{
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
  }
}
```

## Debugging

Enable debug output:

```javascript
// In setup.js
broker = new Broker({ debug: true })

// In test setup
client = new Client(pipe, { debug: true })
```

Check broker status:

```javascript
beforeAll(async () => {
  console.log('Pipe:', process.env.EPHEMERAL_PIPE)
  const pong = await client.ping()
  console.log('Broker ping:', pong, 'ms')
})
```

## Troubleshooting

**Tests can't connect to broker**

- Verify `EPHEMERAL_PIPE` is set: `console.log(process.env.EPHEMERAL_PIPE)`
- Check globalSetup ran: add debug logging

**Leases not releasing**

- Always use `afterEach` to release
- Set TTL so leases expire: `client.lease(key, worker, 60000)`

**Parallel tests interfering**

- Use unique worker IDs: include `process.pid`
- Use lease/release pattern instead of direct get/set

**Jest hangs at end**

- Ensure globalTeardown stops broker: `broker.stop()`
- Check for unreleased leases blocking shutdown

**Different behavior locally vs CI**

- Set HMAC secret in CI: `EPHEMERAL_SECRET=xxx`
- Increase worker count to match CI parallelism
