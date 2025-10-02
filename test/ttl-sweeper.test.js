import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function testTTLSweeper() {
  console.log('Testing TTL sweeper functionality...')

  const testPipeId = 'test-sweeper-' + Date.now()
  const broker = new Broker({ pipeId: testPipeId, debug: true, requireTTL: false })

  try {
    // Start broker
    const pipePath = await broker.start()
    console.log('Broker started, testing sweeper...')

    // Create client
    const client = new Client(pipePath, { debug: true })

    // Test Case 1: Item should be removed by sweeper after TTL expires
    console.log('\nTest 1: Sweeper removes expired items')
    await client.set('temp', 'val', 100) // 100ms TTL

    // Verify it's there initially
    const val1 = await client.get('temp')
    console.log('Initial value:', val1)

    // Wait for it to expire
    await sleep(150)

    // Manually trigger sweep for testing (normally runs every 30s)
    broker.sweepExpired()

    // Check that it's been swept
    const items = await client.list()
    if (!items.temp) {
      console.log('✅ Test 1 passed: Expired item was swept')
    } else {
      console.error('❌ Test 1 failed: Item still exists after sweep')
      process.exit(1)
    }

    // Test Case 2: Non-expired items should not be swept
    console.log('\nTest 2: Sweeper keeps non-expired items')
    await client.set('permanent', 'stays', 60000) // 60s TTL
    await client.set('expired', 'goes', 50) // 50ms TTL

    await sleep(100)
    broker.sweepExpired()

    const items2 = await client.list()
    if (items2.permanent && !items2.expired) {
      console.log('✅ Test 2 passed: Non-expired kept, expired removed')
    } else {
      console.error('❌ Test 2 failed: Wrong items after sweep')
      process.exit(1)
    }

    // Test Case 3: handleGet still works (doesn't break existing TTL check)
    console.log('\nTest 3: handleGet TTL check still works')
    await client.set('quick', 'value', 50) // 50ms TTL
    await sleep(60)

    try {
      await client.get('quick')
      console.error('❌ Test 3 failed: Should have thrown expired error')
      process.exit(1)
    } catch (err) {
      if (err.message === 'expired') {
        console.log('✅ Test 3 passed: handleGet correctly detects expired')
      } else {
        console.error('❌ Test 3 failed: Wrong error:', err.message)
        process.exit(1)
      }
    }

    // Test the provided test case exactly
    console.log('\nTest 4: Provided test case')
    await client.set('temp', 'val', 100) // 100ms TTL
    await sleep(150)

    // Manually trigger sweep (in production it runs every 30s)
    broker.sweepExpired()

    const items3 = await client.list()
    console.assert(!items3.temp, 'Item should be swept')
    console.log('✅ Test 4 passed: Provided test case works')

    // Clean up
    broker.stop()
    console.log('\n✅ All TTL sweeper tests passed!')
  } catch (err) {
    console.error('Test failed:', err)
    broker.stop()
    process.exit(1)
  }
}

testTTLSweeper().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
