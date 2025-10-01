# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ephemeral Pipe Broker is a cross-platform, in-memory IPC broker for sharing secrets, tokens, and ephemeral state between parallel processes without touching disk or opening ports. Built with zero external dependencies using only Node.js core modules.

**Core design philosophy:**

- Ephemeral by design: state exists only while the broker process runs
- Security first: TTL required, random pipe names, strict size limits, HMAC auth optional
- Single-host only: uses named pipes (UNIX domain sockets on Mac/Linux, Named Pipes on Windows)
- Small payloads only: designed for tokens, credentials, session IDs (KB-sized values)

## Commands

### Run Tests

```bash
npm test
```

Runs basic.test.js with set/get/del/TTL/ping operations.

To run individual tests:

```bash
node test/basic.test.js
node test/stale-socket.test.js
node test/ttl-sweeper.test.js
node test/size-limits.test.js
node test/sweeper-interval.test.js
```

### Debug Mode

When testing or developing, use `debug: true` option to see broker operations:

```javascript
const broker = new Broker({ debug: true })
```

## Architecture

### Three-Module Structure

1. **broker.js** - Server-side pipe server
   - Creates net.Server listening on random pipe path
   - Handles newline-delimited JSON requests
   - In-memory Map store with TTL + LRU eviction
   - TTL sweeper runs every 30 seconds (configurable via sweeperInterval)
   - spawn() method launches child process with EPHEMERAL_PIPE exported
   - Graceful shutdown: clears store, unlinks socket, kills child

2. **client.js** - Client library
   - Automatic retry with exponential backoff (50ms, 100ms, 200ms, 400ms, 800ms)
   - Retries on ECONNREFUSED, ENOENT, EPIPE errors
   - 5-second default timeout (configurable)
   - Simple API: get(), set(), del(), list(), ping()

3. **pipe-utils.js** - Cross-platform pipe path generation
   - Windows: `\\\\.\\pipe\\broker-{random}`
   - Unix: `/tmp/broker-{random}.sock`
   - cleanupPipe() handles socket file removal on Unix

### Protocol

**Request:** Newline-delimited JSON over pipe

```json
{"action":"set","key":"foo","value":"bar","ttl":60000}\n
{"action":"get","key":"foo"}\n
```

**Response:** JSON with ok flag

```json
{"ok":true}\n
{"ok":true,"value":"bar"}\n
{"ok":false,"error":"not_found"}\n
```

### Storage Model

Map of `{ key → { value, expires } }`

- TTL always set (defaults to 30 minutes if not specified)
- Sweeper runs every 30s to remove expired entries
- Size limits enforced: 1MB max request, 256KB max value (configurable)

### Lifecycle

1. Broker.start() → creates pipe, exports EPHEMERAL_PIPE
2. Broker.spawn(command, args) → launches child with env var
3. Child process runs, clients connect
4. Child exits → broker.stop() → clears store, unlinks socket, exits

### Stale Socket Handling

On Unix systems, broker.start() checks for existing socket files:

- If broker is running → throws error
- If socket exists but broker not running → removes stale socket
- See broker.js:24-38, checkIfBrokerRunning() method

### Error Handling

Client retries connection failures automatically. Broker returns:

- `too_large` - request or value exceeds size limit
- `invalid_json` - malformed request
- `not_found` - key doesn't exist
- `expired` - key existed but TTL passed
- `unknown_action` - unsupported action

## Security Model

**Threat model:** Protecting API tokens, STS credentials, OAuth tokens, test fixtures from disk persistence and unauthorized access.

**Features:**

- Random pipe names generated fresh on every run
- UNIX socket permissions default to 0700
- Optional HMAC auth on each request
- TTL required for all keys
- Size caps prevent memory exhaustion
- Graceful teardown clears store on exit

**Out of scope:**

- Cross-host secret sharing
- Long-term storage (use Vault/KMS)
- Protection against root-level attackers

## Future Extensibility

The codebase is designed for plugins and adapters (not yet implemented):

- Plugins: register new actions via broker.register(name, handler)
- Middleware: inspect/modify requests before handlers
- Adapters: framework-specific wrappers (@ephemeral-broker/wdio, etc.)

See ARCHITECTURE.md for full plugin design.
