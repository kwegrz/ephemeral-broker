# Ephemeral Broker Examples

Quick-start examples showing how to use ephemeral-broker with popular testing frameworks.

## Examples

### [WebdriverIO](./wdio-basic)

Coordinate parallel browser tests with unique test accounts and shared sessions.

```bash
cd examples/wdio-basic
npm install
npm test
```

**Use cases:**

- Account leasing for parallel workers
- Shared authentication tokens
- API rate limiting
- Test data sharing

### [Playwright](./playwright-basic)

Manage browser profiles and coordinate parallel Playwright tests.

```bash
cd examples/playwright-basic
npm install
npx playwright install chromium
npm test
```

**Use cases:**

- Unique browser profiles
- Session cookie sharing
- API rate limiting
- Test fixture sharing

### [Jest](./jest-parallel)

Coordinate parallel Jest tests with shared resources.

```bash
cd examples/jest-parallel
npm install
npm test
```

**Use cases:**

- Database connection pooling
- API key sharing
- Rate limit coordination
- Parallel data processing

## Common Patterns

### Pattern 1: Account/Resource Leasing

Give each parallel worker a unique resource from a pool:

```javascript
const workerId = `worker-${process.pid}`
const accountNum = await client.lease('test-accounts', workerId, 60000)

// Use account
await login(accountNum)

// Release when done
await client.release(workerId)
```

### Pattern 2: Shared Authentication

First worker generates token, others reuse it:

```javascript
let token = await client.get('auth-token').catch(async () => {
  const newToken = await authenticate()
  await client.set('auth-token', newToken, 3600000)
  return newToken
})

// All workers use the same token
```

### Pattern 3: Rate Limiting

Coordinate API calls across parallel workers:

```javascript
const callNum = await client.lease('api-calls', workerId, 5000)
console.log(`API call #${callNum}`)

await makeApiCall()

await client.release(workerId)
```

### Pattern 4: Expensive Setup

Share costly setup across all workers:

```javascript
let fixture = await client.get('test-data').catch(async () => {
  const data = await loadExpensiveData()
  await client.set('test-data', data)
  return data
})
// All workers reuse the same fixture
```

## Best Practices

### 1. Start Broker in Global Setup

**WebdriverIO:**

```javascript
// wdio.conf.js
async onPrepare() {
  broker = new Broker()
  await broker.start()
}
```

**Playwright:**

```javascript
// playwright.config.js
globalSetup: async () => {
  broker = new Broker()
  await broker.start()
  return async () => broker.stop()
}
```

**Jest:**

```javascript
// setup.js
export default async function globalSetup() {
  broker = new Broker()
  await broker.start()
}
```

### 2. Always Set TTL

Prevents memory leaks if workers crash:

```javascript
await client.set('key', 'value', 60000) // 60 second TTL
await client.lease('resource', workerId, 60000) // Auto-release after 60s
```

### 3. Release Leases

Use cleanup hooks to release resources:

```javascript
afterEach(async () => {
  await client.release(workerId)
})
```

### 4. Use HMAC Auth in CI

```bash
export EPHEMERAL_SECRET="your-secret-here"
```

```javascript
broker = new Broker({ secret: process.env.EPHEMERAL_SECRET })
client = new Client(pipe, { secret: process.env.EPHEMERAL_SECRET })
```

### 5. Unique Worker IDs

Prevent collisions between parallel workers:

```javascript
const workerId = `worker-${process.pid}-${Date.now()}`
// or
const workerId = `worker-${browser.sessionId}`
```

## Troubleshooting

### Workers Can't Connect

**Check pipe is exported:**

```javascript
console.log('EPHEMERAL_PIPE:', process.env.EPHEMERAL_PIPE)
```

**Verify broker started:**

```javascript
const pong = await client.ping()
console.log('Broker responded in', pong, 'ms')
```

### Tests Hanging

**Always release leases:**

```javascript
try {
  const resource = await client.lease('pool', workerId, 60000)
  // use resource
} finally {
  await client.release(workerId)
}
```

**Set TTL so leases auto-expire:**

```javascript
await client.lease('pool', workerId, 60000) // Expires after 60s
```

### Authentication Failures

**Match secrets:**

```javascript
// Broker and client must use same secret
broker = new Broker({ secret: 'my-secret' })
client = new Client(pipe, { secret: 'my-secret' })
```

**Or disable auth for testing:**

```javascript
broker = new Broker() // No secret = no auth
```

## Framework-Specific Tips

### WebdriverIO

- Start broker in `onPrepare`, stop in `onComplete`
- Use `browser.sessionId` for worker IDs
- Access client in `before` hook

### Playwright

- Use `globalSetup` to start broker
- Return teardown function from globalSetup
- Initialize client in `test.beforeAll`

### Jest

- Use `globalSetup.js` and `globalTeardown.js`
- Store broker in `global.__BROKER__`
- Enable ESM: `node --experimental-vm-modules`

## See Also

- [Main Documentation](../README.md)
- [Architecture Guide](../ARCHITECTURE.md)
- [Security Best Practices](../SECURITY.md)
