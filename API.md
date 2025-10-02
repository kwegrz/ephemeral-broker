# API Reference

Complete API documentation for ephemeral-broker.

## Table of Contents

- [Broker Class](#broker-class)
- [Client Class](#client-class)
- [Common Use Cases](#common-use-cases)
- [Error Handling](#error-handling)

---

## Broker Class

The `Broker` class creates and manages the IPC server.

### Constructor

```javascript
import { Broker } from 'ephemeral-broker'

const broker = new Broker(options)
```

#### Options

| Option                 | Type      | Default   | Description                                  |
| ---------------------- | --------- | --------- | -------------------------------------------- |
| `debug`                | `boolean` | `false`   | Enable debug logging                         |
| `requireTTL`           | `boolean` | `true`    | Require TTL for all keys                     |
| `defaultTTL`           | `number`  | `1800000` | Default TTL in milliseconds (30 minutes)     |
| `maxItems`             | `number`  | `10000`   | Maximum number of items in store             |
| `maxRequestSize`       | `number`  | `1048576` | Maximum request size in bytes (1 MB)         |
| `maxValueSize`         | `number`  | `262144`  | Maximum value size in bytes (256 KB)         |
| `secret`               | `string`  | `null`    | HMAC secret for authentication               |
| `compression`          | `boolean` | `true`    | Enable gzip compression for large values     |
| `compressionThreshold` | `number`  | `1024`    | Minimum size in bytes to trigger compression |
| `sweeperInterval`      | `number`  | `30000`   | TTL sweeper interval in milliseconds (30s)   |
| `idleTimeout`          | `number`  | `null`    | Auto-shutdown after idle milliseconds        |
| `heartbeatInterval`    | `number`  | `null`    | Heartbeat logging interval in milliseconds   |
| `logLevel`             | `string`  | `'info'`  | Log level: `debug`, `info`, `warn`, `error`  |
| `structuredLogging`    | `boolean` | `false`   | Enable JSON structured logging               |
| `metrics`              | `boolean` | `true`    | Enable metrics collection                    |
| `pipeId`               | `string`  | (random)  | Custom pipe ID (default: random)             |

**Example:**

```javascript
const broker = new Broker({
  debug: true,
  requireTTL: true,
  secret: process.env.EPHEMERAL_SECRET,
  maxItems: 5000,
  sweeperInterval: 10000 // 10 seconds
})
```

### Methods

#### `async start()`

Starts the broker server and exports `EPHEMERAL_PIPE` environment variable.

**Returns:** `Promise<string>` - Pipe path

**Example:**

```javascript
const pipe = await broker.start()
console.log('Broker listening on:', pipe)
// Outputs: /tmp/broker-abc123.sock (Unix) or \\.\pipe\broker-abc123 (Windows)
```

#### `stop()`

Stops the broker, clears all data, and removes socket file.

**Returns:** `void`

**Example:**

```javascript
broker.stop()
// Store cleared, server closed, socket file unlinked
```

#### `spawn(command, args)`

Spawns a child process with `EPHEMERAL_PIPE` exported. Broker exits when child exits.

**Parameters:**

- `command` (string): Command to execute
- `args` (array): Command arguments

**Returns:** `ChildProcess`

**Example:**

```javascript
broker.spawn('npm', ['test'])
// Runs: npm test
// Environment includes EPHEMERAL_PIPE=/tmp/broker-xyz.sock
```

#### `async drain(timeout)`

Gracefully drains in-flight requests before shutdown.

**Parameters:**

- `timeout` (number): Max wait time in milliseconds (default: 5000)

**Returns:** `Promise<void>`

**Example:**

```javascript
await broker.drain(10000) // Wait up to 10 seconds
broker.stop()
```

#### `setupSignalHandlers()`

Sets up SIGINT/SIGTERM handlers for graceful shutdown.

**Returns:** `void`

**Example:**

```javascript
broker.setupSignalHandlers()
// Now Ctrl+C will gracefully drain and stop broker
```

---

## Client Class

The `Client` class connects to the broker and performs operations.

### Constructor

```javascript
import { Client } from 'ephemeral-broker'

const client = new Client(pipe, options)
```

**Parameters:**

- `pipe` (string, optional): Pipe path (defaults to `process.env.EPHEMERAL_PIPE`)

#### Options

| Option                 | Type      | Default | Description                                  |
| ---------------------- | --------- | ------- | -------------------------------------------- |
| `debug`                | `boolean` | `false` | Enable debug logging                         |
| `timeout`              | `number`  | `5000`  | Request timeout in milliseconds              |
| `allowNoTtl`           | `boolean` | `false` | Allow set() without TTL                      |
| `secret`               | `string`  | `null`  | HMAC secret (defaults to `EPHEMERAL_SECRET`) |
| `compression`          | `boolean` | `true`  | Enable compression for large values          |
| `compressionThreshold` | `number`  | `1024`  | Minimum size in bytes to trigger compression |

**Example:**

```javascript
const client = new Client(process.env.EPHEMERAL_PIPE, {
  debug: true,
  timeout: 10000,
  secret: process.env.EPHEMERAL_SECRET
})
```

### Methods

#### `async get(key)`

Retrieves a value by key.

**Parameters:**

- `key` (string): Key to retrieve

**Returns:** `Promise<any>` - Value (automatically decompressed if needed)

**Throws:**

- `not_found` - Key doesn't exist
- `expired` - Key existed but TTL expired

**Example:**

```javascript
const token = await client.get('api-token')
console.log(token) // "sk-abc123..."
```

#### `async set(key, value, ttl)`

Stores a key-value pair with TTL.

**Parameters:**

- `key` (string): Key to store
- `value` (any): Value (will be JSON serialized)
- `ttl` (number, optional): TTL in milliseconds (required unless `allowNoTtl: true`)

**Returns:** `Promise<boolean>` - True on success

**Throws:**

- `too_large` - Value exceeds `maxValueSize`
- `max_items` - Store is full
- TTL error if `requireTTL` is true and TTL not provided

**Example:**

```javascript
// Store token for 5 minutes
await client.set('api-token', 'sk-abc123...', 5 * 60 * 1000)

// Store object
await client.set('user', { id: 123, name: 'Alice' }, 60000)

// Large values are automatically compressed if compression enabled
await client.set('big-data', largeArray, 300000)
```

#### `async del(key)`

Deletes a key.

**Parameters:**

- `key` (string): Key to delete

**Returns:** `Promise<boolean>` - True on success

**Example:**

```javascript
await client.del('api-token')
// Key removed from store
```

#### `async list()`

Lists all active (non-expired) keys.

**Returns:** `Promise<string[]>` - Array of keys

**Example:**

```javascript
const keys = await client.list()
console.log(keys) // ['api-token', 'user', 'session-123']
```

#### `async ping()`

Health check that returns round-trip latency.

**Returns:** `Promise<number>` - Latency in milliseconds

**Example:**

```javascript
const latency = await client.ping()
console.log(`Broker latency: ${latency}ms`)
```

#### `async stats()`

Returns broker statistics.

**Returns:** `Promise<object>` - Statistics object

**Stats Object:**

```javascript
{
  items: 42,              // Number of active items
  leases: 5,              // Number of active leases
  memory: {
    rss: 52428800,        // Resident set size (bytes)
    heapUsed: 12345678,   // Heap used (bytes)
    approximateStoreBytes: 8192  // Estimated store size (bytes)
  },
  uptime: 12345           // Broker uptime (milliseconds)
}
```

**Example:**

```javascript
const stats = await client.stats()
console.log(`Broker has ${stats.items} items`)
console.log(`Memory: ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`)
console.log(`Uptime: ${(stats.uptime / 1000).toFixed(0)}s`)
```

#### `async health()`

Returns broker health status.

**Returns:** `Promise<object>` - Health object

**Health Object:**

```javascript
{
  ok: true,
  status: 'healthy',
  uptime: 12345,
  items: 42,
  leases: 5
}
```

**Example:**

```javascript
const health = await client.health()
if (health.ok) {
  console.log('Broker is healthy')
}
```

#### `async metrics()`

Returns performance metrics.

**Returns:** `Promise<object>` - Metrics object

**Metrics Object:**

```javascript
{
  requests: {
    total: 1234,
    get: 500,
    set: 400,
    // ... per-action counts
  },
  errors: {
    total: 10,
    not_found: 8,
    too_large: 2
  },
  latency: {
    p50: 1,
    p95: 3,
    p99: 5
  }
}
```

**Example:**

```javascript
const metrics = await client.metrics()
console.log(`Total requests: ${metrics.requests.total}`)
console.log(`P95 latency: ${metrics.latency.p95}ms`)
```

#### `async lease(key, workerId, ttl)`

Atomically acquires a lease from a pool.

**Parameters:**

- `key` (string): Lease pool key
- `workerId` (string): Unique worker identifier
- `ttl` (number, optional): Lease TTL in milliseconds

**Returns:** `Promise<number>` - Lease value (0-indexed)

**How it works:**

- Multiple workers can lease from the same `key`
- Each worker gets a unique incrementing value (0, 1, 2, ...)
- Leases are exclusive: only one worker can hold a specific value
- Expired leases are automatically recycled

**Example:**

```javascript
// 5 workers lease from pool of 10
const workerId = `worker-${process.pid}`
const accountId = await client.lease('test-accounts', workerId, 60000)
console.log(`Worker ${workerId} got account ${accountId}`)
// Worker 1 gets 0, Worker 2 gets 1, etc.

// Use the account
await runTestWithAccount(accountId)

// Release when done
await client.release(workerId)
```

#### `async release(workerId)`

Releases a lease held by a worker.

**Parameters:**

- `workerId` (string): Worker identifier (must match lease())

**Returns:** `Promise<boolean>` - True if lease existed and was released

**Example:**

```javascript
const released = await client.release('worker-123')
if (released) {
  console.log('Lease released successfully')
}
```

---

## Common Use Cases

### 1. Basic Key-Value Storage

```javascript
import { Broker, Client } from 'ephemeral-broker'

// Start broker
const broker = new Broker()
const pipe = await broker.start()

// Use client
const client = new Client(pipe)

// Store ephemeral data
await client.set('session-token', 'abc123', 300000) // 5 min TTL
const token = await client.get('session-token')
console.log(token) // 'abc123'

// Clean up
broker.stop()
```

### 2. Parallel Test Coordination

```javascript
// In global test setup (runs once)
import { Broker } from 'ephemeral-broker'

export default async function globalSetup() {
  const broker = new Broker({ debug: true })
  await broker.start()
  global.__BROKER__ = broker
}

// In each test worker
import { Client } from 'ephemeral-broker'

const client = new Client() // Uses EPHEMERAL_PIPE env var

// Each worker leases unique test account
const workerId = `worker-${process.pid}`
const accountId = await client.lease('test-accounts', workerId, 60000)

// Run test with exclusive account
test('should login', async () => {
  await loginWithAccount(accountId)
  // ...
})

// Release after test
afterEach(async () => {
  await client.release(workerId)
})
```

### 3. Shared Authentication

```javascript
// First worker generates token
let token = await client.get('auth-token').catch(() => null)

if (!token) {
  // Generate new token
  token = await generateAuthToken()
  await client.set('auth-token', token, 3600000) // 1 hour
}

// All other workers reuse the same token
await makeApiCall(token)
```

### 4. Rate Limiting Coordination

```javascript
// Coordinate API calls across parallel workers
const workerId = `worker-${Date.now()}`
const callNumber = await client.lease('api-rate-limit', workerId, 5000)

console.log(`Making API call #${callNumber}`)
await fetch('https://api.example.com/data')

await client.release(workerId)
```

### 5. HMAC Authentication

```javascript
// Server
const secret = crypto.randomBytes(32).toString('hex')
const broker = new Broker({ secret })
await broker.start()

// Client (must use same secret)
const client = new Client(pipe, { secret })

// All requests are now authenticated
await client.set('key', 'value', 60000)
// Request includes HMAC signature, verified by broker
```

### 6. Compression for Large Values

```javascript
const broker = new Broker({
  compression: true,
  compressionThreshold: 1024 // Compress values >1KB
})

const client = new Client(pipe, {
  compression: true,
  compressionThreshold: 1024
})

// Large values automatically compressed
const bigData = new Array(10000).fill('x')
await client.set('big-data', bigData, 60000)
// Automatically gzipped before sending

const retrieved = await client.get('big-data')
// Automatically decompressed
```

### 7. Monitoring and Observability

```javascript
// Check broker health
const health = await client.health()
if (!health.ok) {
  console.error('Broker unhealthy!')
}

// Get detailed stats
const stats = await client.stats()
console.log(`Items: ${stats.items}`)
console.log(`Memory: ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`)

// Get performance metrics
const metrics = await client.metrics()
console.log(`P99 latency: ${metrics.latency.p99}ms`)
console.log(`Error rate: ${((metrics.errors.total / metrics.requests.total) * 100).toFixed(2)}%`)
```

### 8. Graceful Shutdown

```javascript
const broker = new Broker()
await broker.start()

// Setup signal handlers
broker.setupSignalHandlers()

// On SIGINT/SIGTERM:
// 1. Drain in-flight requests (wait up to 5s)
// 2. Clear store
// 3. Close server
// 4. Unlink socket
```

### 9. Spawn Child Process

```javascript
const broker = new Broker()
await broker.start()

// Spawn test suite with EPHEMERAL_PIPE exported
broker.spawn('npm', ['test'])

// Broker stays alive while child runs
// Broker exits when child exits
```

### 10. Custom TTL Per Item

```javascript
// Short-lived temporary data
await client.set('temp-flag', true, 5000) // 5 seconds

// Test session data
await client.set('session', sessionData, 300000) // 5 minutes

// Longer-lived cached data
await client.set('api-response', data, 3600000) // 1 hour
```

---

## Error Handling

### Client Errors

```javascript
try {
  await client.get('missing-key')
} catch (err) {
  console.error(err.message) // 'not_found'
}
```

**Common errors:**

- `not_found` - Key doesn't exist
- `expired` - Key existed but TTL expired
- `too_large` - Value or request exceeds size limits
- `max_items` - Store is full
- `auth_failed` - HMAC authentication failed
- `ttl_required` - TTL not provided when `requireTTL: true`
- `Request timeout` - Request exceeded timeout

### Retry Logic

Client automatically retries on connection errors:

- `ECONNREFUSED` - Broker not started yet
- `ENOENT` - Socket file doesn't exist
- `EPIPE` - Broken pipe
- `ETIMEDOUT` - Connection timeout

**Retry schedule:** 50ms, 100ms, 200ms, 400ms, 800ms (exponential backoff)

**Example:**

```javascript
// Client will retry if broker isn't ready yet
const client = new Client()

// Automatically retries up to 5 times
try {
  await client.ping()
} catch (err) {
  console.error('Broker not available after 5 retries')
}
```

### Broker Errors

```javascript
try {
  await broker.start()
} catch (err) {
  if (err.message === 'Broker already running') {
    console.error('Another broker is using this socket')
  }
}
```

---

## Advanced Configuration

### Structured Logging

```javascript
const broker = new Broker({
  logLevel: 'debug',
  structuredLogging: true
})

// Logs in JSON format:
// {"level":"info","component":"broker","message":"Broker started","pipe":"/tmp/broker-xyz.sock"}
```

### Idle Timeout

```javascript
const broker = new Broker({
  idleTimeout: 60000 // Auto-shutdown after 60s of inactivity
})

// Broker exits if no requests received for 60 seconds
```

### Heartbeat Logging

```javascript
const broker = new Broker({
  heartbeatInterval: 10000 // Log stats every 10 seconds
})

// Periodically logs:
// [broker] Heartbeat: uptime=12345ms, items=42, leases=5, memory=12.5MB
```

### Disable Metrics

```javascript
const broker = new Broker({
  metrics: false // Disable metrics collection
})

// client.metrics() will return empty data
```

---

## TypeScript Support

Type definitions are included (see `index.d.ts`).

```typescript
import { Broker, Client } from 'ephemeral-broker'

const broker: Broker = new Broker({ debug: true })
const pipe: string = await broker.start()

const client: Client = new Client(pipe)
const value: any = await client.get('key')

interface User {
  id: number
  name: string
}

const user: User = await client.get('user')
```

---

## Environment Variables

- `EPHEMERAL_PIPE` - Pipe path (auto-set by `broker.start()`)
- `EPHEMERAL_SECRET` - HMAC secret (optional, for authentication)

**Example:**

```bash
export EPHEMERAL_SECRET=$(openssl rand -hex 32)
node test.js
```

---

## Limits and Constraints

| Limit              | Default | Configurable | Description              |
| ------------------ | ------- | ------------ | ------------------------ |
| Max request size   | 1 MB    | Yes          | `maxRequestSize` option  |
| Max value size     | 256 KB  | Yes          | `maxValueSize` option    |
| Max items          | 10,000  | Yes          | `maxItems` option        |
| Request timeout    | 5s      | Yes          | Client `timeout` option  |
| TTL sweeper        | 30s     | Yes          | `sweeperInterval` option |
| Compression thresh | 1 KB    | Yes          | `compressionThreshold`   |

**Example:**

```javascript
const broker = new Broker({
  maxItems: 1000, // Stricter limit
  maxValueSize: 100 * 1024 // 100 KB
})
```

---

## Platform Support

- **macOS**: Unix domain sockets (`/tmp/broker-*.sock`)
- **Linux**: Unix domain sockets (`/tmp/broker-*.sock`)
- **Windows**: Named pipes (`\\.\pipe\broker-*`)

All features work cross-platform. File permissions (`0700`) only apply to Unix systems.

---

## Performance

See [BENCHMARKS.md](./BENCHMARKS.md) for detailed performance characteristics.

**Quick stats (M1 Max, Node.js v22):**

- **SET**: 12,285 ops/sec
- **GET**: 26,882 ops/sec
- **Latency**: P99 ≤ 1ms
- **Memory**: ~1,566 bytes per item

---

## Security

See [SECURITY.md](./SECURITY.md) for security considerations.

**Key points:**

- Use HMAC auth in CI/CD (`secret` option)
- Always set TTL to limit exposure window
- Monitor memory usage (`client.stats()`)
- Not designed for production use
