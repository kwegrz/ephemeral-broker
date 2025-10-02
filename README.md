Ephemeral Pipe Broker

Fast, secure, ephemeral IPC over pipes.
Share secrets, tokens, and small state between parallel processes without touching disk or opening ports. Cleans itself up automatically when your process exits.

⸻

Core Value Props 1. One Thing Well — A temporary KV/lease store over pipes. That’s it. 2. Zero Dependencies — Core uses only Node built-ins. 3. Security First — HMAC auth, size limits, TTL required by default. 4. Plugin Architecture — Extend without bloating core. 5. Cross-Platform — Works the same on Mac, Linux, and Windows.

⸻

Why

Most modern dev/test environments run into the same problems:
• Secrets on disk → API keys, STS creds, and OAuth tokens end up written to .env or cache files.
• Parallel worker collisions → WDIO, Playwright, Jest, etc. spawn many workers with no safe way to share ephemeral state.
• Lifecycle pollution → bootstrap state lingers after jobs, causing flaky tests and security risks.

Ephemeral Pipe Broker solves this:
• Starts before your process.
• Exposes a random local pipe (/tmp/…sock or \\.\pipe\…).
• Brokers secrets/state in memory only.
• Wipes itself clean on exit.

⸻

Install

npm install --save-dev ephemeral-pipe-broker ephemeral-pipe-client

⸻

Quickstart

1. Spawn broker with your command

npx ephemeral-pipe-broker start -- pnpm test

Broker:
• generates a random pipe,
• exports it to child as EPHEMERAL_PIPE,
• spawns your command,
• exits + wipes memory when done.

2. Use the client

import { PipeClient } from 'ephemeral-pipe-client';

const client = new PipeClient(process.env.EPHEMERAL_PIPE);

// Set a value with TTL
await client.set('foo', 'bar', 60000);
console.log(await client.get('foo')); // "bar"

// Lease tokens per worker
const token = await client.lease('publisher-api', process.env.WORKER_ID);

3. With adapter (WDIO example)

import { withBrokerTokens } from '@ephemeral-broker/wdio';

export const config = withBrokerTokens({
tokens: {
publisher: 'publisher-api-token',
admin: 'admin-api-token'
},
envVars: true
}, baseConfig);

⸻

CLI Usage

# Simple: run tests with broker

npx ephemeral-pipe-broker start -- pnpm test

# With plugin

epb start --plugin @ephemeral-broker/aws-sts -- pnpm test

# Debug mode

epb start --debug --auth $SECRET -- pnpm test

⸻

Client API

class PipeClient {
constructor(pipe?: string, options?: { auth?: string, timeout?: number })

get(key: string): Promise<any>
set(key: string, value: any, ttlMs?: number): Promise<void>
del(key: string): Promise<void>

lease(key: string, workerId?: string, ttlMs?: number): Promise<any>
renew(workerId?: string): Promise<any>
release(workerId?: string): Promise<void>

stats(): Promise<{ items: number, leases: number, memory: number, uptime: number }>
ping(): Promise<boolean>
}

⸻

Adapters & Plugins
• @ephemeral-broker/wdio – WDIO integration (leases tokens per worker, auto-renew, release on exit).
• @ephemeral-broker/aws-sts – AWS STS plugin (mint + cache creds in memory).
• Upcoming:
• @ephemeral-broker/playwright
• @ephemeral-broker/jest
• @ephemeral-broker/testcafe
• @ephemeral-broker/rate-limit
• @ephemeral-broker/mock

⸻

Publishing Strategy

# Phase 1: Core

npm publish ephemeral-pipe-broker
npm publish ephemeral-pipe-client

# Phase 2: Immediate adapter

npm publish @ephemeral-broker/wdio

# Phase 3: Common asks

npm publish @ephemeral-broker/aws-sts
npm publish @ephemeral-broker/rate-limit

# Phase 4: Ecosystem

@ephemeral-broker/playwright
@ephemeral-broker/jest
@ephemeral-broker/mock

⸻

Usage Patterns
• Testing: WDIO, Playwright, TestCafe, Jest workers share tokens + fixtures.
• CI/CD: distribute secrets, share build state, coordinate artifacts (same runner).
• Dev Tools: ESLint/Prettier caches, hot reload flags, monorepo build state.
• Security-Sensitive Apps: OAuth broker, AWS STS, temporary creds.

⸻

Performance

Tested on Apple M1 Max, Node.js v22.17.0:

| Operation | Ops/sec | P50 (ms) | P95 (ms) | P99 (ms) |
| --------- | ------- | -------- | -------- | -------- |
| SET       | 12,285  | 0        | 1        | 1        |
| GET       | 26,882  | 0        | 0        | 1        |
| DEL       | 26,042  | 0        | 0        | 1        |
| PING      | 27,027  | 0        | 0        | 1        |

Memory: ~1,566 bytes per item

See [BENCHMARKS.md](./BENCHMARKS.md) for details and how to run benchmarks on your system.

⸻

Alternatives Comparison

### vs Redis

| Feature          | Ephemeral-Broker                              | Redis                                 |
| ---------------- | --------------------------------------------- | ------------------------------------- |
| **Setup**        | Zero config, auto-start                       | Install + daemon setup required       |
| **Transport**    | Unix domain sockets / Named pipes             | TCP (network stack overhead)          |
| **Performance**  | 12-27k ops/sec (same-host IPC)                | 50-100k ops/sec (TCP)                 |
| **Ports**        | None (uses pipes)                             | Requires port (default 6379)          |
| **Security**     | Filesystem permissions (0700) + optional HMAC | Requires auth config + firewall rules |
| **Persistence**  | None (ephemeral only)                         | Optional (RDB/AOF)                    |
| **Multi-host**   | ❌ Same-host only                             | ✅ Network accessible                 |
| **Dependencies** | Zero (Node.js built-ins)                      | Redis server + client library         |
| **Cleanup**      | Auto on process exit                          | Manual or systemd management          |
| **Use Case**     | Test coordination, parallel workers           | Production caching, queues, pub/sub   |

**When to use ephemeral-broker:**

- Coordinating parallel test workers (WDIO, Playwright, Jest)
- Sharing ephemeral secrets without disk writes
- Zero-setup local development
- Single-host IPC only

**When to use Redis:**

- Production caching with persistence
- Multi-host distributed systems
- Advanced data structures (sorted sets, streams)
- Pub/sub messaging across services

### vs Filesystem (temp files)

| Feature             | Ephemeral-Broker              | Filesystem                     |
| ------------------- | ----------------------------- | ------------------------------ |
| **Speed**           | 12-27k ops/sec (in-memory)    | 100-1000 ops/sec (disk I/O)    |
| **Security**        | No disk writes                | Secrets written to disk        |
| **Cleanup**         | Automatic on exit             | Manual cleanup required        |
| **Atomicity**       | Atomic lease/release          | Requires file locking          |
| **Concurrency**     | High (parallel clients)       | Limited (file lock contention) |
| **TTL**             | Built-in automatic expiration | Manual TTL implementation      |
| **Race Conditions** | No (atomic operations)        | Yes (TOCTOU, stale locks)      |
| **Crash Recovery**  | Clean (no residue)            | Stale files/locks remain       |

**When to use ephemeral-broker:**

- Sharing secrets that must never touch disk
- Coordinating parallel workers with leases
- Atomic operations (counters, flags)
- Fast in-memory state

**When to use filesystem:**

- Large datasets (>1GB)
- Persistent state needed across runs
- Legacy code using file-based config
- Cross-process sharing without dependencies

### vs SharedArrayBuffer

| Feature            | Ephemeral-Broker                | SharedArrayBuffer                  |
| ------------------ | ------------------------------- | ---------------------------------- |
| **Data Types**     | JSON (strings, objects, arrays) | Raw bytes only                     |
| **Serialization**  | Automatic (JSON)                | Manual (DataView, TypedArrays)     |
| **Process Model**  | Independent processes           | Threads/workers in same process    |
| **Cross-Platform** | ✅ Mac, Linux, Windows          | ✅ Browser + Node.js               |
| **Setup**          | Simple (import + connect)       | Complex (worker setup, Atomics)    |
| **TTL**            | Built-in                        | Manual implementation              |
| **Lease/Release**  | Built-in atomic operations      | Manual with Atomics.wait/notify    |
| **Type Safety**    | Structured data (JSON)          | Byte manipulation only             |
| **Memory Model**   | Isolated processes              | Shared memory with race conditions |

**When to use ephemeral-broker:**

- Coordinating separate processes (not threads)
- Structured data (tokens, config objects)
- Simple API for key/value + leases
- Cross-process without shared memory complexity

**When to use SharedArrayBuffer:**

- High-frequency updates (>100k ops/sec)
- Raw binary data (buffers, TypedArrays)
- Workers in same Node.js process
- Lock-free algorithms with Atomics

### Summary

**Ephemeral-Broker is optimized for:**

- ✅ Same-host parallel process coordination
- ✅ Zero-setup ephemeral state (no daemon)
- ✅ No disk writes (secrets stay in memory)
- ✅ No ports (uses Unix sockets / Named pipes)
- ✅ Automatic cleanup on exit

**Not suitable for:**

- ❌ Production caching (use Redis)
- ❌ Multi-host coordination (use Redis/etcd)
- ❌ Large datasets >1GB (use filesystem/database)
- ❌ Ultra-high throughput >100k ops/sec (use SharedArrayBuffer)
- ❌ Persistent state across runs (use database)

⸻

Troubleshooting

### Error: `EADDRINUSE` or stale socket

**Symptom**: Broker fails to start with `Error: listen EADDRINUSE`

**Cause**: A previous broker process crashed and left a socket file in `/tmp/` (Unix) or a named pipe handle (Windows).

**Solution**:

```bash
# Unix/Mac: Remove stale socket files
rm -f /tmp/broker-*.sock

# Windows: Named pipes clean up automatically, but check for hung processes
tasklist | findstr node
taskkill /F /PID <process_id>
```

The broker automatically detects and removes stale sockets on Unix systems (see `broker.js:24-38`), but if you see this error, manually clean up the socket files.

### Error: `EPERM` (Windows)

**Symptom**: Permission denied when creating or connecting to named pipes on Windows

**Cause**: Windows named pipes require consistent elevation context. If the broker runs elevated (admin) but the client doesn't, or vice versa, connections will fail.

**Solution**:

1. Run both broker and clients in the same elevation context (both elevated or both normal)
2. In CI/CD, ensure all processes run with the same permissions
3. Avoid `runas` or `sudo` for individual commands - elevate the entire terminal session

### Error: Timeouts / `ECONNREFUSED`

**Symptom**: Client times out or gets "connection refused" errors

**Cause**:

- Broker not started before client connects
- `EPHEMERAL_PIPE` environment variable not set or incorrect
- Broker crashed silently

**Solutions**:

```javascript
// 1. Verify EPHEMERAL_PIPE is set
console.log('Pipe:', process.env.EPHEMERAL_PIPE)
// Should output: /tmp/broker-xxxxx.sock (Unix) or \\.\pipe\broker-xxxxx (Windows)

// 2. Increase client timeout (default: 5000ms)
const client = new Client(pipe, { timeout: 10000 })

// 3. Check broker is running
await client.ping() // Should return number (latency in ms)

// 4. Enable debug mode to see connection attempts
const broker = new Broker({ debug: true })
const client = new Client(pipe, { debug: true })
```

**Common causes:**

- Test framework started before `globalSetup` completed
- Broker stopped too early (before all workers finished)
- Using wrong pipe path (hardcoded instead of `process.env.EPHEMERAL_PIPE`)

### Memory Usage Climbing

**Symptom**: Broker memory usage grows continuously, eventually hitting limits

**Cause**:

- TTL not set on keys (data never expires)
- Too many unique keys being created
- Large values being stored (exceeds intended use case)

**Solutions**:

```javascript
// 1. Always set TTL (broker enforces this by default)
await client.set('key', 'value', 60000) // 60 second TTL

// 2. Monitor memory with stats endpoint
const stats = await client.stats()
console.log('Items:', stats.items)
console.log('Memory:', stats.memory.heapUsed)

// 3. Reduce maxItems limit to prevent unbounded growth
const broker = new Broker({ maxItems: 1000 }) // Default: 10,000

// 4. Reduce sweeper interval to clean up expired items faster
const broker = new Broker({ sweeperInterval: 10000 }) // 10s (default: 30s)

// 5. Set smaller TTLs for temporary data
await client.set('temp-data', value, 5000) // 5 seconds
```

### Error: `too_large`

**Symptom**: Client gets `too_large` error when setting values

**Cause**: Value or request exceeds size limits

**Solution**:

```javascript
// Default limits:
// - maxRequestSize: 1 MB
// - maxValueSize: 256 KB

// Increase limits if needed (not recommended for ephemeral data)
const broker = new Broker({
  maxRequestSize: 5 * 1024 * 1024, // 5 MB
  maxValueSize: 1 * 1024 * 1024 // 1 MB
})

// Or: Split large data into smaller chunks
const chunks = splitIntoChunks(largeData, 200 * 1024) // 200 KB chunks
for (let i = 0; i < chunks.length; i++) {
  await client.set(`data-chunk-${i}`, chunks[i])
}
```

**Note**: Ephemeral-broker is designed for small, temporary data (tokens, session IDs, config flags). For large datasets, use Redis or filesystem storage.

### Workers Can't Connect in Parallel Tests

**Symptom**: Some workers connect successfully, others timeout or fail

**Cause**:

- Race condition: workers start before broker exports `EPHEMERAL_PIPE`
- Workers inherit different environment variables

**Solution**:

```javascript
// 1. Use framework-specific global setup hooks
// Playwright
export default defineConfig({
  globalSetup: async () => {
    const broker = new Broker()
    await broker.start() // Exports EPHEMERAL_PIPE to all workers
    return async () => broker.stop()
  }
})

// Jest
export default async function globalSetup() {
  const broker = new Broker()
  await broker.start()
  global.__BROKER__ = broker
}

// WebdriverIO
export const config = {
  async onPrepare() {
    broker = new Broker()
    await broker.start()
  }
}

// 2. Add retry logic in workers
let client
for (let i = 0; i < 5; i++) {
  try {
    client = new Client(process.env.EPHEMERAL_PIPE)
    await client.ping()
    break
  } catch (err) {
    if (i === 4) throw err
    await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)))
  }
}
```

### HMAC Authentication Failures

**Symptom**: Client gets `auth_failed` error

**Cause**: Client and broker using different secrets, or secret not set

**Solution**:

```javascript
// 1. Ensure same secret on both sides
const secret = process.env.EPHEMERAL_SECRET || 'my-test-secret'
const broker = new Broker({ secret })
const client = new Client(pipe, { secret })

// 2. Or disable auth for local testing
const broker = new Broker() // No secret = no auth
const client = new Client(pipe) // No secret = no auth

// 3. In CI/CD, set EPHEMERAL_SECRET as environment variable
// GitHub Actions:
// env:
//   EPHEMERAL_SECRET: ${{ secrets.EPHEMERAL_SECRET }}
```

**Security note**: Always use HMAC authentication in CI/CD environments. Only disable for local development.

### Getting Help

If you encounter issues not covered here:

1. Enable debug mode: `{ debug: true }` on both broker and client
2. Check `EPHEMERAL_PIPE` value: `echo $EPHEMERAL_PIPE`
3. Verify broker is running: `await client.ping()`
4. Check broker stats: `await client.stats()`
5. Open an issue at: https://github.com/kwegrz/ephemeral-broker/issues

⸻

Security

For detailed security information, see [SECURITY.md](./SECURITY.md).

**Key security features:**

- ✅ Ephemeral state (broker dies → secrets vanish)
- ✅ No disk writes (memory-only storage)
- ✅ Random pipe names (generated fresh on every run)
- ✅ Unix socket permissions (0700, owner-only)
- ✅ Optional HMAC authentication (timing-safe)
- ✅ Required TTL (prevents memory leaks)
- ✅ Size limits (prevents DoS)
- ✅ Zero external dependencies (supply chain safety)

**Threat model:** Protects against accidental disk persistence, unauthorized local access, memory exhaustion, and stale data leakage. Not designed for multi-host security or root-level attackers.

⸻

Why This Will Succeed 1. Solves real pain — tokens on disk, port conflicts, worker collisions. 2. Simple mental model — just a temp KV/lease store over a pipe. 3. Easy adoption — npx ephemeral-pipe-broker start -- your-command. 4. Framework-agnostic — not tied to WDIO or any specific stack. 5. Safe defaults — LRU, TTL, auth, caps, heartbeat all built-in.

This isn't another heavy service. It's essential infrastructure in ~200 LOC.
