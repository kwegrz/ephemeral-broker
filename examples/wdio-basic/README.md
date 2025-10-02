# WebdriverIO + Ephemeral Broker Example

This example shows how to use ephemeral-broker to coordinate parallel WebdriverIO tests.

## Use Cases

- **Account Leasing**: Give each parallel worker a unique test account
- **Shared Authentication**: Share tokens/sessions across workers
- **Rate Limiting**: Coordinate API calls across parallel tests
- **Test Data**: Share test fixtures without file I/O

## Setup

```bash
npm install
```

## Run Tests

```bash
npm test
```

This will:

1. Start the broker in `onPrepare` hook
2. Run 5 parallel Chrome workers
3. Each worker leases unique resources from the broker
4. Stop the broker in `onComplete` hook

## How It Works

### 1. Broker Setup (wdio.conf.js)

```javascript
import { Broker } from 'ephemeral-broker'

let broker

export const config = {
  maxInstances: 5,

  async onPrepare() {
    broker = new Broker({ requireTTL: false })
    await broker.start()
  },

  async onComplete() {
    broker.stop()
  }
}
```

### 2. Account Leasing

Each worker gets a unique account (1-10):

```javascript
const accountNum = await client.lease('test-accounts', workerId, 60000)
// Worker 1 gets account 1
// Worker 2 gets account 2
// etc.
```

### 3. Shared State

Workers share authentication tokens:

```javascript
let token = await client.get('auth-token').catch(() => null)
if (!token) {
  token = generateToken()
  await client.set('auth-token', token)
}
// All workers use the same token
```

### 4. Rate Limiting

Coordinate API calls using atomic counters:

```javascript
const counter = await client.lease('api-calls', workerId, 5000)
console.log(`API call #${counter}`)
await client.release(workerId)
```

## Best Practices

1. **Use HMAC auth in CI**: Set `EPHEMERAL_SECRET` environment variable
2. **Set appropriate TTLs**: Prevents memory leaks if tests crash
3. **Release leases**: Always call `client.release()` when done
4. **Handle errors**: Broker may not be available during test failures

## Common Patterns

### Test Account Pool

```javascript
// Lease from pool of 10 accounts
const account = await client.lease('accounts', workerId, 60000)

// Use account for test
await login(account)

// Release back to pool
await client.release(workerId)
```

### Shared Setup/Teardown

```javascript
// First worker does setup
let setupDone = await client.get('setup').catch(() => null)
if (!setupDone) {
  await doExpensiveSetup()
  await client.set('setup', true)
}

// All workers can now proceed
```

### Debug Output

Enable broker debug logging:

```javascript
broker = new Broker({ debug: true })
```

Enable client debug logging:

```javascript
client = new Client(pipe, { debug: true })
```

## Troubleshooting

**Workers can't connect to broker**

- Check `EPHEMERAL_PIPE` is exported: `echo $EPHEMERAL_PIPE`
- Verify broker started before tests: check console output

**Leases not releasing**

- Make sure to call `client.release(workerId)` in test cleanup
- Set TTL on leases so they auto-expire: `client.lease(key, worker, 60000)`

**Auth failures**

- Ensure client secret matches broker: both use same `EPHEMERAL_SECRET`
- Or disable auth for testing: don't set `secret` option
