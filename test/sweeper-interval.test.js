import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function testSweeperInterval() {
  console.log('Testing automatic sweeper interval (quick test with manual trigger)...')

  const testPipeId = 'test-interval-' + Date.now()
  const broker = new Broker({ pipeId: testPipeId, debug: false })

  try {
    // Start broker
    const pipePath = await broker.start()

    // Verify sweeper interval was set
    if (broker.sweeperInterval) {
      console.log('✅ Sweeper interval created on start')
    } else {
      console.error('❌ Sweeper interval not created')
      process.exit(1)
    }

    // Create client and add some items with short TTL
    const client = new Client(pipePath)
    await client.set('item1', 'value1', 100)
    await client.set('item2', 'value2', 200)
    await client.set('item3', 'value3', 30000) // Long TTL

    console.log('Added 3 items with different TTLs')

    // Wait for items to expire
    await sleep(250)

    // Manually trigger sweep to simulate interval
    console.log('Triggering manual sweep...')
    broker.sweepExpired()

    // Check results
    const items = await client.list()
    if (!items.item1 && !items.item2 && items.item3) {
      console.log('✅ Sweeper correctly removed only expired items')
    } else {
      console.error('❌ Sweeper did not work correctly')
      console.error('Items:', items)
      process.exit(1)
    }

    // Test that stop() clears the interval
    broker.stop()
    if (!broker.sweeperInterval) {
      console.log('✅ Sweeper interval cleared on stop')
    } else {
      console.error('❌ Sweeper interval not cleared')
      process.exit(1)
    }

    console.log('\n✅ All sweeper interval tests passed!')
    console.log('Note: In production, sweeper runs automatically every 30 seconds')
  } catch (err) {
    console.error('Test failed:', err)
    broker.stop()
    process.exit(1)
  }
}

testSweeperInterval().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
