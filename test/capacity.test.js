import { Broker, Client } from '../src/index.js'

async function test() {
  console.log('Testing capacity warnings and health checks...\n')

  // Test 1: Health check with low utilization
  console.log('Test 1: Health check with low utilization')
  const broker = new Broker({
    maxItems: 10,
    debug: false
  })
  const pipePath = await broker.start()
  const client = new Client(pipePath)

  // Add a few items
  await client.set('key1', 'value1', 5000)
  await client.set('key2', 'value2', 5000)

  let health = await client.health()
  console.log(
    '✓ Health status:',
    health.status,
    '(items:',
    health.capacity.items,
    '/ max:',
    health.capacity.maxItems,
    ')'
  )
  console.log('✓ Utilization:', health.capacity.utilization)
  console.log('✓ Near capacity:', health.capacity.nearCapacity)
  console.log('✓ Warning:', health.capacity.warning || 'none')

  // Test 2: Approach 90% capacity
  console.log('\nTest 2: Approaching 90% capacity (near_capacity)')
  await client.set('key3', 'value3', 5000)
  await client.set('key4', 'value4', 5000)
  await client.set('key5', 'value5', 5000)
  await client.set('key6', 'value6', 5000)
  await client.set('key7', 'value7', 5000)
  await client.set('key8', 'value8', 5000)
  await client.set('key9', 'value9', 5000)

  health = await client.health()
  console.log(
    '✓ Health status:',
    health.status,
    '(items:',
    health.capacity.items,
    '/ max:',
    health.capacity.maxItems,
    ')'
  )
  console.log('✓ Utilization:', health.capacity.utilization)
  console.log('✓ Near capacity:', health.capacity.nearCapacity)
  console.log('✓ Warning:', health.capacity.warning)

  // Test 3: Reach 100% capacity
  console.log('\nTest 3: Reaching 100% capacity (at_capacity)')
  await client.set('key10', 'value10', 5000)

  health = await client.health()
  console.log('✓ Health status:', health.status, '(degraded expected)')
  console.log('✓ Utilization:', health.capacity.utilization)
  console.log('✓ At capacity:', health.capacity.atCapacity)
  console.log('✓ Warning:', health.capacity.warning)

  // Test 4: Try to add another item (should fail)
  console.log('\nTest 4: Attempting to exceed capacity')
  try {
    await client.set('key11', 'value11', 5000)
    console.log('✗ Should have failed (maxItems exceeded)')
  } catch (err) {
    console.log('✓ Correctly rejected:', err.message)
  }

  // Test 5: Check stats includes capacity
  console.log('\nTest 5: Stats endpoint includes capacity')
  const stats = await client.stats()
  console.log('✓ Stats capacity:', stats.capacity)

  // Test 6: Check metrics includes capacity
  console.log('\nTest 6: Metrics includes capacity')
  const metrics = await client.metrics()
  const hasCapacity =
    metrics.includes('ephemeral_broker_capacity_items') &&
    metrics.includes('ephemeral_broker_capacity_max') &&
    metrics.includes('ephemeral_broker_capacity_utilization')
  console.log('✓ Capacity metrics present:', hasCapacity)

  // Test 7: Delete items and check utilization drops
  console.log('\nTest 7: Utilization drops after deleting items')
  await client.del('key1')
  await client.del('key2')
  await client.del('key3')

  health = await client.health()
  console.log('✓ Health status:', health.status, '(should be healthy again)')
  console.log('✓ Items:', health.capacity.items)
  console.log('✓ Utilization:', health.capacity.utilization)
  console.log('✓ Near capacity:', health.capacity.nearCapacity)

  broker.stop()

  console.log('\n✓ All capacity tests passed!')
}

test().catch(err => {
  console.error('✗ Test failed:', err)
  process.exit(1)
})
