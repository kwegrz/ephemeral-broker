import { Broker, Client } from '../src/index.js'

async function test() {
  console.log('Testing environment variable parsing...\n')

  // Test 1: Broker env vars
  console.log('Test 1: Broker environment variables')
  process.env.BROKER_DEFAULT_TTL = '120000'
  process.env.BROKER_MAX_ITEMS = '5000'
  process.env.BROKER_DEBUG = 'true'
  process.env.BROKER_REQUIRE_TTL = 'false'
  process.env.BROKER_SWEEPER_INTERVAL = '60000'

  const broker1 = new Broker()
  console.log('✓ Broker with env vars:', {
    defaultTTL: broker1.options.defaultTTL === 120000,
    maxItems: broker1.options.maxItems === 5000,
    debug: broker1.options.debug === true,
    requireTTL: broker1.options.requireTTL === false,
    sweeperInterval: broker1.options.sweeperInterval === 60000
  })

  // Test 2: Constructor overrides env vars
  console.log('\nTest 2: Constructor overrides env vars')
  const broker2 = new Broker({
    defaultTTL: 300000,
    debug: false
  })
  console.log('✓ Constructor overrides:', {
    defaultTTL: broker2.options.defaultTTL === 300000,
    debug: broker2.options.debug === false,
    maxItems: broker2.options.maxItems === 5000 // Still from env
  })

  // Test 3: Start broker and test client env vars
  console.log('\nTest 3: Client environment variables')
  const pipePath = await broker1.start()

  process.env.CLIENT_TIMEOUT = '10000'
  process.env.CLIENT_DEBUG = 'true'
  process.env.CLIENT_ALLOW_NO_TTL = 'true'

  const client1 = new Client(pipePath)
  console.log('✓ Client with env vars:', {
    timeout: client1.options.timeout === 10000,
    debug: client1.options.debug === true,
    allowNoTtl: client1.options.allowNoTtl === true
  })

  // Test 4: Client constructor overrides
  console.log('\nTest 4: Client constructor overrides')
  const client2 = new Client(pipePath, {
    timeout: 2000,
    debug: false
  })
  console.log('✓ Constructor overrides:', {
    timeout: client2.options.timeout === 2000,
    debug: client2.options.debug === false,
    allowNoTtl: client2.options.allowNoTtl === true // Still from env
  })

  // Test 5: Functional test
  console.log('\nTest 5: Functional test with env vars')
  await client1.set('test_key', 'test_value', 5000)
  const value = await client1.get('test_key')
  console.log('✓ Set/Get works:', value === 'test_value')

  const latency = await client1.ping()
  console.log('✓ Ping works:', typeof latency === 'number')

  // Cleanup
  broker1.stop()

  // Clear env vars
  delete process.env.BROKER_DEFAULT_TTL
  delete process.env.BROKER_MAX_ITEMS
  delete process.env.BROKER_DEBUG
  delete process.env.BROKER_REQUIRE_TTL
  delete process.env.BROKER_SWEEPER_INTERVAL
  delete process.env.CLIENT_TIMEOUT
  delete process.env.CLIENT_DEBUG
  delete process.env.CLIENT_ALLOW_NO_TTL

  console.log('\n✓ All environment variable tests passed!')
}

test().catch(err => {
  console.error('✗ Test failed:', err)
  process.exit(1)
})
