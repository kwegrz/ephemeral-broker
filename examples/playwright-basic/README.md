# Playwright + Ephemeral Broker Example

This example demonstrates using ephemeral-broker for parallel Playwright test coordination.

## Use Cases

- **Browser Profile Management**: Unique profiles for parallel workers
- **Session Sharing**: Share cookies/auth across browser contexts
- **API Rate Limiting**: Coordinate external API calls
- **Test Fixtures**: Share test data without file I/O

## Setup

```bash
npm install
npx playwright install chromium  # Install browser
```

## Run Tests

```bash
npm test
```

This will:

1. Start broker in `globalSetup`
2. Run 5 parallel workers
3. Each worker coordinates via the broker
4. Stop broker in global teardown

## How It Works

### 1. Global Setup (playwright.config.js)

```javascript
import { Broker } from 'ephemeral-broker'

let broker

export default defineConfig({
  workers: 5,

  globalSetup: async () => {
    broker = new Broker()
    await broker.start()

    return async () => {
      broker.stop()
    }
  }
})
```

### 2. Browser Profile Leasing

Each worker gets a unique profile:

```javascript
const profileId = await client.lease('browser-profiles', workerId, 60000)
// Worker 1 → profile 1
// Worker 2 → profile 2
```

### 3. Session Sharing

All workers share the same session:

```javascript
let sessionCookie = await client.get('session-cookie').catch(() => null)
if (!sessionCookie) {
  sessionCookie = { name: 'session_id', value: generateId() }
  await client.set('session-cookie', sessionCookie)
}
await page.context().addCookies([sessionCookie])
```

### 4. API Rate Limiting

```javascript
const callNumber = await client.lease('api-rate-limit', workerId, 5000)
await request.get('/api/endpoint')
await client.release(workerId)
```

## Best Practices

1. **Use `beforeAll` for client setup**: Initialize once per worker
2. **Set TTLs on shared state**: Prevents stale data between runs
3. **Release leases in test cleanup**: Use `afterEach` or `finally`
4. **Handle broker unavailability**: Tests should gracefully fail

## Common Patterns

### Unique Browser Profiles

```javascript
test('each worker gets unique profile', async ({ page }) => {
  const workerId = `worker-${browser.browserType().name()}`
  const profileId = await client.lease('profiles', workerId, 60000)

  // Use profile for test
  await page.goto('/profile/' + profileId)

  await client.release(workerId)
})
```

### Shared Authentication

```javascript
test.beforeAll(async ({ request }) => {
  let token = await client.get('auth-token').catch(() => null)
  if (!token) {
    const response = await request.post('/api/login', {
      data: { user: 'test', pass: 'test' }
    })
    token = await response.json()
    await client.set('auth-token', token, 3600000) // 1 hour TTL
  }
  // All workers use this token
})
```

### Test Data Fixtures

```javascript
test.beforeAll(async () => {
  let fixture = await client.get('test-data').catch(async () => {
    const data = await loadExpensiveFixture()
    await client.set('test-data', data)
    return data
  })
  // Share fixture across all workers
})
```

## Debugging

Enable debug output:

```javascript
// In playwright.config.js
broker = new Broker({ debug: true })

// In test setup
client = new Client(pipe, { debug: true })
```

Check broker connectivity:

```javascript
test.beforeAll(async () => {
  const pong = await client.ping()
  console.log('Broker ping:', pong, 'ms')
})
```

## Troubleshooting

**Broker not available**

- Check `EPHEMERAL_PIPE` env var: `console.log(process.env.EPHEMERAL_PIPE)`
- Verify globalSetup ran before tests

**Parallel tests interfering**

- Use unique worker IDs: `worker-${browser.browserType().name()}-${Date.now()}`
- Lease resources instead of direct get/set

**Tests hanging**

- Always release leases: use `test.afterEach`
- Set TTL so leases auto-expire if test crashes

**Different results locally vs CI**

- Enable HMAC auth in CI: set `EPHEMERAL_SECRET`
- Increase worker timeout if broker startup is slow
