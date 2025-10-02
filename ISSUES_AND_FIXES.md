# Issues and Fixes for Ephemeral Broker

**Generated:** 2025-10-02
**Review Type:** Comprehensive Code Review & Architecture Analysis

---

## 🚨 CRITICAL ISSUES (Must Fix Before Production)

### Issue #1: Sweeper Interval Not Configurable ⚠️ PRIORITY: HIGH

**File:** `src/broker.js:620-627`

**Problem:**

- Documentation claims sweeper interval is "configurable via sweeperInterval" (CLAUDE.md:52)
- Constructor accepts `sweeperInterval` option
- `startSweeper()` **ignores the option** and hardcodes 30000ms

**Current Code:**

```javascript
startSweeper() {
  this.sweeperInterval = setInterval(() => {
    this.sweepExpired()
  }, 30000)  // ← Hardcoded!
  this.sweeperInterval.unref()
}
```

**Impact:**

- Users cannot tune sweep frequency for their use case
- High-frequency testing may accumulate expired items between sweeps
- Low-frequency usage wastes CPU on unnecessary sweeps

**Fix:**

```javascript
startSweeper() {
  const interval = this.options.sweeperInterval || 30000
  this.sweeperInterval = setInterval(() => {
    this.sweepExpired()
  }, interval)
  this.sweeperInterval.unref()
}
```

**Test Coverage Needed:**

- Test custom sweeper interval
- Test that expired items are swept at configured frequency

---

### Issue #2: Compression Error Handling Missing ⚠️ PRIORITY: MEDIUM

**File:** `src/client.js:169-202`

**Problem:**

- `compressValue()` can throw if value has circular references or invalid JSON
- No try/catch wrapper around compression
- Error message provides no context about which key or operation failed

**Current Code:**

```javascript
if (shouldCompress) {
  const serialized = JSON.stringify(value)
  beforeSize = serialized.length
  finalValue = await this.compressValue(value) // ⚠️ Can throw
  afterSize = finalValue.length
  compressed = true
}
```

**Impact:**

- Cryptic error messages for users
- Difficult to debug which set() operation failed
- Circular JSON structures cause crashes

**Fix:**

```javascript
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
        `Hint: Check for circular references or non-serializable values.`
    )
  }
}
```

**Test Coverage Needed:**

- Test circular reference handling
- Test compression error messages
- Test invalid JSON values

---

### Issue #3: Signal Handler Memory Leak ⚠️ PRIORITY: CRITICAL

**File:** `src/broker.js:117-131`

**Problem:**

- `setupSignalHandlers()` adds new signal handlers every time it's called
- If `start()` is called multiple times (e.g., in tests), handlers **stack up**
- Each handler creates a closure over `this`, preventing garbage collection
- Multiple drain/stop calls will execute on a single signal

**Current Code:**

```javascript
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
    process.on(signal, handler)  // ⚠️ Adds new handler every time
  }
}
```

**Impact:**

- Memory leak in test suites that start/stop broker multiple times
- Multiple handlers fire on single signal, causing race conditions
- Difficult to debug "why is my broker being cleaned up twice?"

**Fix Option 1 (Early Return):**

```javascript
setupSignalHandlers() {
  // Skip if already set up
  if (this.signalHandlers.size > 0) {
    return
  }

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
```

**Fix Option 2 (Guard in start()):**

```javascript
async start() {
  // Prevent starting twice
  if (this.server) {
    throw new Error('Broker already started. Call stop() before starting again.')
  }

  // ... rest of start logic
}
```

**Test Coverage Needed:**

- Test calling start() multiple times throws error
- Test signal handlers are not duplicated
- Test graceful cleanup in test suites

---

### Issue #4: Duplicate Signal Handlers in spawn() ⚠️ PRIORITY: CRITICAL

**File:** `src/broker.js:606-615`

**Problem:**

- `spawn()` adds **new** signal handlers for SIGINT/SIGTERM
- These duplicate the handlers already set up in `setupSignalHandlers()`
- When a signal is received, **both handlers fire**, creating a race condition
- One handler calls `process.exit(0)`, the other calls `process.exit(1)`

**Current Code:**

```javascript
// In setupSignalHandlers() - line 121-126
const handler = async () => {
  this.logger.info('Received shutdown signal', { signal })
  await this.drain()
  this.stop()
  process.exit(0) // ← Exit with 0
}

// In spawn() - line 607-615
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    // ⚠️ DUPLICATE HANDLER!
    if (this.child) {
      this.child.kill(sig)
    }
    this.stop()
    process.exit(1) // ← Exit with 1
  })
}
```

**Impact:**

- **Race condition:** Two handlers compete to exit the process
- **Unpredictable exit codes:** Sometimes 0, sometimes 1
- **Double cleanup:** `stop()` called twice, could cause errors
- **Child process handling:** May not properly wait for child to exit

**Fix Option 1 (Unified Handler):**

```javascript
setupSignalHandlers() {
  if (this.signalHandlers.size > 0) return

  const signals = ['SIGINT', 'SIGTERM']

  for (const signal of signals) {
    const handler = async () => {
      this.logger.info('Received shutdown signal', { signal })

      // Kill child process if running
      if (this.child) {
        this.logger.debug('Sending signal to child process', { signal })
        this.child.kill(signal)

        // Wait briefly for child to exit gracefully
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      await this.drain()
      this.stop()
      process.exit(0)
    }

    this.signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }
}

spawn(command, args = []) {
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

  // Remove duplicate signal handlers - they're already set up!
  return this.child
}
```

**Fix Option 2 (Flag-Based Guard):**

```javascript
setupSignalHandlers() {
  if (this.signalHandlers.size > 0) return

  let shuttingDown = false
  const signals = ['SIGINT', 'SIGTERM']

  for (const signal of signals) {
    const handler = async () => {
      if (shuttingDown) return  // Prevent double execution
      shuttingDown = true

      this.logger.info('Received shutdown signal', { signal })

      if (this.child) {
        this.child.kill(signal)
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      await this.drain()
      this.stop()
      process.exit(0)
    }

    this.signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }
}
```

**Test Coverage Needed:**

- Test signal handling with spawned child process
- Test exit codes are consistent
- Test child process receives signal
- Test broker doesn't call stop() twice
- Test no race conditions in signal handlers

---

### Issue #5: Compression Metrics Boolean Logic ⚠️ PRIORITY: LOW

**File:** `src/broker.js:407-411`

**Problem:**

- Uses `if (compressed && beforeSize && afterSize)` to check if metrics should be recorded
- If `beforeSize` or `afterSize` are **0** (falsy), metrics aren't recorded
- While unlikely (empty string = 0 bytes), it's sloppy boolean logic

**Current Code:**

```javascript
// Record compression metrics
if (compressed && beforeSize && afterSize) {
  this.metrics.recordCompression(beforeSize, afterSize)
} else if (!compressed) {
  this.metrics.recordUncompressed()
}
```

**Impact:**

- Edge case: compressing empty value (0 bytes) doesn't record metrics
- Missing metrics data for analysis
- Inconsistent metrics reporting

**Fix:**

```javascript
// Record compression metrics
if (compressed && beforeSize !== undefined && afterSize !== undefined) {
  this.metrics.recordCompression(beforeSize, afterSize)
} else if (!compressed) {
  this.metrics.recordUncompressed()
}
```

**Test Coverage Needed:**

- Test compressing empty/tiny values records metrics correctly

---

### Issue #6: Decompression Error Handling ⚠️ PRIORITY: MEDIUM

**File:** `src/client.js:158-167`

**Problem:**

- If broker returns `compressed: true` but value is **not valid base64** or **corrupted gzip**
- `decompressValue()` throws opaque error like "invalid input"
- No context about which key failed or why

**Current Code:**

```javascript
async get(key) {
  const response = await this.request({ action: 'get', key })

  // Decompress if needed
  if (response.compressed) {
    return await this.decompressValue(response.value)  // ⚠️ Can throw
  }

  return response.value
}
```

**Impact:**

- Debugging nightmare when decompression fails
- User doesn't know if it's network corruption, broker bug, or storage issue
- No actionable error message

**Fix:**

```javascript
async get(key) {
  const response = await this.request({ action: 'get', key })

  if (response.compressed) {
    try {
      return await this.decompressValue(response.value)
    } catch (err) {
      throw new Error(
        `Failed to decompress value for key "${key}": ${err.message}. ` +
        `This may indicate data corruption or a broker version mismatch.`
      )
    }
  }

  return response.value
}
```

**Test Coverage Needed:**

- Test corrupted compressed data handling
- Test error messages are helpful

---

### Issue #7: Infinite Promise Anti-Pattern ⚠️ PRIORITY: LOW

**File:** `bin/broker.js:54`

**Problem:**

- Uses `await new Promise(() => {})` to keep process alive
- Creates a promise that **never resolves**
- While it works, it's an anti-pattern and ugly

**Current Code:**

```javascript
// No command - just keep broker running
console.log(`Broker running on: ${pipe}`)
console.log('Press Ctrl+C to stop')

// Keep process alive
await new Promise(() => {})
```

**Impact:**

- Code smell / readability issue
- Confusing to maintainers
- Not idiomatic Node.js

**Fix Option 1 (stdin.resume):**

```javascript
// No command - just keep broker running
console.log(`Broker running on: ${pipe}`)
console.log('Press Ctrl+C to stop')

// Keep process alive
process.stdin.resume()
```

**Fix Option 2 (setInterval):**

```javascript
// Keep process alive
const keepAlive = setInterval(() => {}, 1 << 30) // ~12 days
```

**Fix Option 3 (Explicit Event Loop):**

```javascript
// Keep process alive until signal
await new Promise(resolve => {
  process.once('SIGINT', resolve)
  process.once('SIGTERM', resolve)
})
```

---

### Issue #8: TTL Zero Edge Case ⚠️ PRIORITY: MEDIUM

**File:** `src/broker.js:367-375, 413`

**Problem:**

- Validates `ttl <= 0` when `requireTTL: true`
- But when `requireTTL: false`, allows `ttl: 0`
- Line 413: `const expires = ttl ? Date.now() + ttl : Date.now() + this.options.defaultTTL`
- `ttl: 0` is falsy, so **silently falls back to default TTL**
- Confusing behavior: user expects 0 = no expiration or immediate expiration

**Current Code:**

```javascript
// Validation
if (this.options.requireTTL) {
  if (ttl === undefined || ttl === null) {
    return { ok: false, error: 'ttl_required' }
  }
  if (ttl <= 0) {
    return { ok: false, error: 'invalid_ttl' }
  }
}

// Later...
const expires = ttl ? Date.now() + ttl : Date.now() + this.options.defaultTTL
```

**Impact:**

- Confusing behavior: `ttl: 0` doesn't do what users expect
- Undocumented fallback to default TTL
- Potential security issue: user thinks they're setting immediate expiration

**Fix Option 1 (Always Validate):**

```javascript
// Validate TTL if provided
if (ttl !== undefined && ttl !== null && ttl <= 0) {
  return { ok: false, error: 'invalid_ttl' }
}

// Require TTL if configured
if (this.options.requireTTL && (ttl === undefined || ttl === null)) {
  return { ok: false, error: 'ttl_required' }
}

const expires = ttl ?? this.options.defaultTTL
```

**Fix Option 2 (Document Behavior):**

- Add comment: "ttl: 0 falls back to defaultTTL"
- Update API docs to clarify this behavior

**Recommendation:** Use Fix Option 1 - always reject `ttl <= 0` as invalid.

---

## 🟡 MEDIUM ISSUES (Should Fix Soon)

### Issue #9: Lease Algorithm O(n²) Complexity ⚠️ PRIORITY: MEDIUM

**File:** `src/broker.js:484-488`

**Problem:**

- Uses simple linear scan to find next available lease value
- For 10 workers: fine (10 iterations max)
- For 1000 workers: **O(n²)** on lease acquisition

**Current Code:**

```javascript
// Generate unique value for this worker
let value = 0
while (leasedValues.has(value)) {
  value++
}
```

**Impact:**

- High-scale parallel testing (100+ workers) becomes bottleneck
- Each lease acquisition scans all existing leases
- Performance degrades quadratically

**Fix Option 1 (Track Next Available):**

```javascript
// In constructor
this.nextLeaseId = new Map()  // key -> next available ID

handleLease({ key, workerId, ttl }) {
  // ... existing validation ...

  // Get next available ID for this key
  let value = this.nextLeaseId.get(key) || 0

  // Find next unused value
  while (leasedValues.has(value)) {
    value++
  }

  // Update next available
  this.nextLeaseId.set(key, value + 1)

  // ... rest of logic ...
}
```

**Fix Option 2 (Min Heap):**

- Use a min-heap to track released IDs
- Always assign lowest available ID
- More complex but guaranteed O(log n) performance

**Recommendation:** Fix Option 1 for simplicity. If >1000 workers become common, revisit.

---

### Issue #10: Size Limit Checks Inefficient ⚠️ PRIORITY: MEDIUM

**File:** `src/broker.js:377-388`

**Problem:**

- For objects: serializes **twice** (once to check size, once later)
- Doesn't account for compression reducing size below limit
- String length ≠ byte size for UTF-8 (multi-byte chars)

**Current Code:**

```javascript
// Check value size limit
if (value && typeof value === 'string' && value.length > this.options.maxValueSize) {
  return { ok: false, error: 'too_large' }
}

// Check serialized size for non-string values
if (value && typeof value !== 'string') {
  const serialized = JSON.stringify(value) // ⚠️ First serialization
  if (serialized.length > this.options.maxValueSize) {
    return { ok: false, error: 'too_large' }
  }
}

// Later: serialized again for compression check
```

**Impact:**

- Performance: double serialization for large objects
- Incorrect size calculation: `'🔥'.length === 2` but UTF-8 bytes = 4
- Compressed values might pass size check but fail limit

**Fix:**

```javascript
// Calculate actual byte size
let byteSize
if (typeof value === 'string') {
  byteSize = Buffer.byteLength(value, 'utf8')
} else {
  const serialized = JSON.stringify(value)
  byteSize = Buffer.byteLength(serialized, 'utf8')
}

// Check uncompressed size
if (byteSize > this.options.maxValueSize) {
  // If compression enabled, check compressed size
  if (compressed && afterSize) {
    const compressedSize = Buffer.byteLength(afterSize, 'utf8')
    if (compressedSize > this.options.maxValueSize) {
      return { ok: false, error: 'too_large' }
    }
  } else {
    return { ok: false, error: 'too_large' }
  }
}
```

**Recommendation:** Accept uncompressed size check for now, add compressed size check later.

---

### Issue #11: Logger Metadata Stringification Bug ⚠️ PRIORITY: LOW

**File:** `src/logger.js:36-40`

**Problem:**

- Metadata objects render as `[object Object]`
- Useless for debugging

**Current Code:**

```javascript
const metaStr = Object.entries(metadata)
  .map(([k, v]) => `${k}=${v}`) // ⚠️ [object Object]
  .join(' ')
```

**Fix:**

```javascript
const metaStr = Object.entries(metadata)
  .map(([k, v]) => {
    const val = typeof v === 'object' ? JSON.stringify(v) : v
    return `${k}=${val}`
  })
  .join(' ')
```

---

### Issue #12: Approximate Bytes Calculation Wrong ⚠️ PRIORITY: LOW

**File:** `src/broker.js:559-564`

**Problem:**

- Assumes UTF-16 encoding (`* 2`) but V8 uses UTF-8 internally
- Doesn't account for compressed values
- Map overhead estimate of 24 bytes is too low (actual ~40-80 bytes)

**Current Code:**

```javascript
approximateBytes += key.length * 2 // ⚠️ Wrong assumption
if (item.value !== undefined) {
  const serialized = JSON.stringify(item.value)
  approximateBytes += serialized.length * 2 // ⚠️ Wrong
}
approximateBytes += 24 // ⚠️ Underestimate
```

**Fix:**

```javascript
// Use Buffer.byteLength for accurate size
approximateBytes += Buffer.byteLength(key, 'utf8')

if (item.compressed) {
  // Compressed values are base64 strings
  approximateBytes += Buffer.byteLength(item.value, 'utf8')
} else if (item.value !== undefined) {
  const serialized = JSON.stringify(item.value)
  approximateBytes += Buffer.byteLength(serialized, 'utf8')
}

// More realistic overhead estimate
approximateBytes += 64 // Map entry + expires + flags
```

**Recommendation:** Either fix properly or rename to `estimatedBytes` and add comment about inaccuracy.

---

### Issue #13: HMAC Validation Timing Attack ⚠️ PRIORITY: HIGH

**File:** `src/broker.js:303-324`

**Problem:**

- If `clientHMAC` is not valid hex, `Buffer.from()` throws
- `timingSafeEqual` throws instead of returning false
- Attacker can crash requests with invalid HMAC format

**Current Code:**

```javascript
return crypto.timingSafeEqual(
  Buffer.from(clientHMAC, 'hex'), // ⚠️ Can throw
  Buffer.from(expectedHMAC, 'hex')
)
```

**Impact:**

- DoS vector: send malformed HMAC to crash requests
- Error leaks information about HMAC validation flow

**Fix:**

```javascript
validateHMAC(msg) {
  if (!msg.hmac || typeof msg.hmac !== 'string') {
    return false
  }

  const clientHMAC = msg.hmac
  const payload = { ...msg }
  delete payload.hmac

  const payloadString = JSON.stringify(payload)
  const expectedHMAC = crypto
    .createHmac('sha256', this.options.secret)
    .update(payloadString)
    .digest('hex')

  try {
    const clientBuffer = Buffer.from(clientHMAC, 'hex')
    const expectedBuffer = Buffer.from(expectedHMAC, 'hex')

    if (clientBuffer.length !== expectedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(clientBuffer, expectedBuffer)
  } catch (err) {
    // Invalid hex format
    return false
  }
}
```

---

### Issue #14: No Backpressure on Socket Buffer ⚠️ PRIORITY: MEDIUM

**File:** `src/broker.js:193-210`

**Problem:**

- Client can send data faster than broker processes
- Buffer grows unbounded until `maxRequestSize` hit
- Memory attack: send 999KB, wait, send 999KB, repeat

**Current Code:**

```javascript
socket.on('data', chunk => {
  buffer += chunk.toString('utf8')

  // Check request size limit
  if (buffer.length > this.options.maxRequestSize) {
    socket.write(JSON.stringify({ ok: false, error: 'too_large' }) + '\n')
    socket.end()
    return
  }
```

**Impact:**

- Memory exhaustion attack vector
- No rate limiting per connection
- Broker can OOM if many clients send max-size requests

**Fix:**

```javascript
handleConnection(socket) {
  if (this.draining) {
    socket.write(JSON.stringify({ ok: false, error: 'draining' }) + '\n')
    socket.end()
    return
  }

  let buffer = ''
  let totalBytes = 0
  const MAX_BUFFER = this.options.maxRequestSize

  socket.on('data', chunk => {
    totalBytes += chunk.length

    // Hard limit: disconnect if too much data
    if (totalBytes > MAX_BUFFER) {
      socket.write(JSON.stringify({ ok: false, error: 'too_large' }) + '\n')
      socket.destroy()
      return
    }

    // Backpressure: pause if buffer growing too fast
    if (buffer.length > MAX_BUFFER / 2) {
      socket.pause()

      // Resume after processing
      process.nextTick(() => {
        socket.resume()
      })
    }

    buffer += chunk.toString('utf8')

    // Process messages...
  })
}
```

---

### Issue #15: Client Retry Doesn't Respect Total Timeout ⚠️ PRIORITY: MEDIUM

**File:** `src/client.js:24-58`

**Problem:**

- Each retry has its own 5-second timeout
- Total time = 5s × 6 attempts = **30 seconds**
- User expects `timeout: 5000` to mean max 5 seconds total

**Current Code:**

```javascript
async request(payload) {
  const retryDelays = [50, 100, 200, 400, 800]
  let lastError = null

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      return await this._attemptRequest(payload)  // ⚠️ 5s timeout each
    } catch (err) {
      // ... retry logic
```

**Fix:**

```javascript
async request(payload) {
  const retryDelays = [50, 100, 200, 400, 800]
  const totalTimeout = this.options.timeout
  const startTime = Date.now()
  let lastError = null

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    // Check if we've exceeded total timeout
    const elapsed = Date.now() - startTime
    if (elapsed >= totalTimeout) {
      throw new Error(`Request timeout after ${elapsed}ms (${attempt} attempts)`)
    }

    try {
      // Reduce per-attempt timeout based on remaining time
      const remainingTime = totalTimeout - elapsed
      const attemptTimeout = Math.min(this.options.timeout, remainingTime)

      return await this._attemptRequest(payload, attemptTimeout)
    } catch (err) {
      lastError = err

      const isRetryable = /* ... */
      if (!isRetryable || attempt === retryDelays.length) {
        throw lastError
      }

      const delay = retryDelays[attempt]
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
```

---

### Issue #16: Process Exit Code Inconsistency ⚠️ PRIORITY: LOW

**File:** `src/broker.js:603, 613`

**Problem:**

- Child exit handler: `process.exit(code || 0)`
- Signal handler: `process.exit(1)`
- If child exits cleanly (0) but signal received, exit code is unpredictable

**Fix:**

- Let child exit handler take precedence
- Remove duplicate signal handlers in spawn()

---

### Issue #17: No Validation on Unix Socket Path Length ⚠️ PRIORITY: MEDIUM

**File:** `src/pipe-utils.js:6-11`

**Problem:**

- Unix domain sockets limited to 108 bytes (UNIX_PATH_MAX)
- If `os.tmpdir()` is long, socket creation fails with cryptic error

**Fix:**

```javascript
export function makePipePath(id) {
  const random = id || crypto.randomBytes(6).toString('hex')

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\broker-${random}`
  }

  const pipePath = path.join(os.tmpdir(), `broker-${random}.sock`)

  // Unix domain sockets have max path length of 108 bytes
  if (pipePath.length >= 108) {
    throw new Error(
      `Pipe path too long (${pipePath.length} >= 108 chars): ${pipePath}\n` +
        `Try setting TMPDIR to a shorter path.`
    )
  }

  return pipePath
}
```

---

## 🟢 MINOR ISSUES (Nice to Have)

### Issue #18: Inconsistent Error Naming Convention

**Problem:** Errors use snake_case (`too_large`, `not_found`) inconsistently with docs

**Fix:** Document the convention or convert to camelCase

---

### Issue #19: Magic Numbers Not Named Constants

**Problem:** `30000`, `10000`, `5000` appear without named constants

**Fix:**

```javascript
const DEFAULT_SWEEPER_INTERVAL_MS = 30_000
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 10_000
const DEFAULT_CLIENT_TIMEOUT_MS = 5_000
```

---

### Issue #20: No JSDoc Comments

**Problem:** Public API methods lack JSDoc for IDE autocomplete

**Fix:** Add JSDoc to all public methods

---

### Issue #21: Test Cleanup Not Guaranteed

**Problem:** If test crashes, `after()` hook doesn't run, broker keeps running

**Fix:** Use `try/finally` or ensure cleanup in `afterEach()`

---

### Issue #22: Prometheus Metrics Not Escaped

**Problem:** If key contains quotes or newlines, Prometheus format breaks

**Fix:** Escape special characters in label values

---

### Issue #23: Client Constructor Error Handling Inconsistent

**Problem:** Constructor throws sync, methods reject async

**Fix:** Make constructor validation async or document the difference

---

### Issue #24: Sweeper Runs on Empty Store

**Problem:** Sweeper runs every 30s even when store is empty

**Fix:**

```javascript
sweepExpired() {
  if (this.store.size === 0 && this.leases.size === 0) {
    return  // Nothing to sweep
  }
  // ... rest of logic
}
```

---

### Issue #25: Metrics Division by Zero Edge Case

**File:** `src/metrics.js:82-85`

**Problem:** If `bytesAfterCompression` is 0, ratio is 0 (should be impossible)

**Fix:** Return `null` or validate data

---

## 🎯 ARCHITECTURAL IMPROVEMENTS

### Issue #26: No Circuit Breaker Pattern

**Problem:** Client retries indefinitely on repeated failures

**Recommendation:** Implement circuit breaker after N consecutive failures

---

### Issue #27: No Request Correlation ID in Responses

**Problem:** Generated in broker but not returned to client

**Recommendation:** Add `correlationId` to all responses for distributed tracing

---

### Issue #28: Metrics Reset Exposed in Production

**Problem:** `metrics.reset()` is public API but should be test-only

**Fix:** Make it package-private or add warning comment

---

## 📋 TESTING GAPS

### Missing Test Coverage:

1. Custom sweeper interval configuration
2. Circular JSON in compression
3. Corrupted compressed data handling
4. Multiple `start()` calls
5. Signal handler race conditions
6. HMAC with invalid hex format
7. Socket path length validation on Unix
8. Client timeout across retries
9. Very long pipe paths
10. Compression with empty values (0 bytes)

---

## 🚀 RECOMMENDED FIX PRIORITY

### Immediate (Before Any Production Use):

1. **Issue #3**: Signal handler memory leak
2. **Issue #4**: Duplicate signal handlers in spawn
3. **Issue #13**: HMAC validation error handling

### Short Term (Next Release):

1. **Issue #1**: Sweeper interval configuration
2. **Issue #6**: Decompression error handling
3. **Issue #8**: TTL zero edge case
4. **Issue #15**: Client retry timeout
5. **Issue #17**: Unix socket path validation

### Medium Term (Next Minor Version):

1. **Issue #9**: Lease algorithm O(n²)
2. **Issue #10**: Size limit efficiency
3. **Issue #14**: Socket backpressure

### Long Term (Future Releases):

1. **Issue #26**: Circuit breaker pattern
2. **Issue #27**: Correlation IDs
3. All remaining minor issues

---

## 📝 DOCUMENTATION NEEDS

### Update Required:

1. **CLAUDE.md** - Fix claim about configurable sweeper interval
2. **API.md** - Document `ttl: 0` behavior
3. **ARCHITECTURE.md** - Document signal handling strategy
4. **README.md** - Add troubleshooting for socket path length
5. **SECURITY.md** - Document HMAC validation edge cases

### New Documentation Needed:

1. **TESTING.md** - How to write tests without leaking brokers
2. **PERFORMANCE.md** - Scalability limits (max workers, max items)
3. **MIGRATION.md** - How to upgrade between versions

---

## 🎓 LESSONS LEARNED

### What This Codebase Does Well:

1. Clean separation of concerns (broker/client/utils)
2. Security-first design (TTL required, size limits, HMAC)
3. Comprehensive test coverage for happy paths
4. Cross-platform support done correctly

### Areas for Improvement:

1. Edge case handling (empty values, invalid input)
2. Error messages with context
3. Signal handler design
4. Resource cleanup guarantees
5. Performance optimization for high-scale

### General Advice for Author:

- **Slow down on features, focus on hardening** - The core is solid, but edge cases need attention
- **Think about failure modes** - What happens when X throws? When Y is zero? When Z happens twice?
- **Add integration tests** - Test suites are good but need chaos/stress testing
- **Document assumptions** - Why does TTL:0 use default? Why is sweeper 30s? Write it down.

---

**Final Grade: B+ (7.5/10)**

This is **not** vibe code - it's well-architected with solid fundamentals. Fix the critical issues (#3, #4, #13) and this is production-ready for its intended use case (test coordination). For high-scale production secret brokering, additional hardening needed.
