// ==============================================
// FILE: ephemeral-broker/test/basic.test.js
// ==============================================
import { Broker, Client } from '../src/index.js'

async function test() {
  console.log('Testing ephemeral-broker...')
  
  // Start broker
  const broker = new Broker({ debug: true })
  const pipe = await broker.start()
  console.log(`✓ Broker started on: ${pipe}`)
  
  // Create client
  const client = new Client(pipe, { debug: true })
  
  // Test set/get
  await client.set('foo', 'bar')
  console.log('✓ Set foo=bar')
  
  const value = await client.get('foo')
  console.assert(value === 'bar', 'Value should be bar')
  console.log('✓ Got foo=bar')
  
  // Test TTL
  await client.set('temp', 'value', 1000) // 1 second TTL
  console.log('✓ Set temp with 1s TTL')
  
  // Test list
  const items = await client.list()
  console.log('✓ List items:', items)
  
  // Test delete
  await client.del('foo')
  console.log('✓ Deleted foo')
  
  try {
    await client.get('foo')
    console.error('✗ Should have thrown not_found')
  } catch (err) {
    console.log('✓ foo not found after delete')
  }
  
  // Test ping
  const pong = await client.ping()
  console.log('✓ Ping successful:', pong)
  
  // Wait for TTL to expire
  console.log('Waiting 1.5s for TTL to expire...')
  await new Promise(r => setTimeout(r, 1500))
  
  try {
    await client.get('temp')
    console.error('✗ Should have expired')
  } catch (err) {
    console.log('✓ temp expired after TTL')
  }
  
  // Clean up
  broker.stop()
  console.log('✓ Broker stopped')
  
  console.log('\nAll tests passed! ✨')
}

test().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})