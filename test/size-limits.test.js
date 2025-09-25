import { Broker } from '../src/broker.js'
import { Client } from '../src/client.js'

async function testSizeLimits() {
  console.log('Testing size limit functionality...')
  
  // Test 1: Value size limit
  console.log('\nTest 1: Value size limit (provided test case)')
  const testPipeId1 = 'test-size-' + Date.now()
  const broker1 = new Broker({ 
    pipeId: testPipeId1, 
    maxValueSize: 256_000, // 256KB
    debug: true 
  })
  
  try {
    const pipePath = await broker1.start()
    const client = new Client(pipePath, { debug: true })
    
    // Create a 300KB string
    const bigValue = 'x'.repeat(300_000)
    console.log(`Attempting to set value of size: ${bigValue.length} bytes`)
    
    try {
      await client.set('big', bigValue)
      console.error('❌ Test 1 failed: Should have thrown too_large error')
      broker1.stop()
      process.exit(1)
    } catch (err) {
      if (err.message === 'too_large') {
        console.log('✅ Test 1 passed: Correctly rejected oversized value')
      } else {
        console.error('❌ Test 1 failed: Wrong error:', err.message)
        broker1.stop()
        process.exit(1)
      }
    }
    
    // Test that smaller values still work
    const smallValue = 'x'.repeat(100_000) // 100KB
    await client.set('small', smallValue)
    const retrieved = await client.get('small')
    if (retrieved === smallValue) {
      console.log('✅ Values under limit work correctly')
    } else {
      console.error('❌ Failed to store value under limit')
      broker1.stop()
      process.exit(1)
    }
    
    broker1.stop()
  } catch (err) {
    console.error('Test 1 setup failed:', err)
    broker1.stop()
    process.exit(1)
  }
  
  // Test 2: Request size limit
  console.log('\nTest 2: Request size limit')
  const testPipeId2 = 'test-req-size-' + Date.now()
  const broker2 = new Broker({ 
    pipeId: testPipeId2,
    maxRequestSize: 10_000, // 10KB
    maxValueSize: 100_000, // 100KB
    debug: true
  })
  
  try {
    const pipePath = await broker2.start()
    const client = new Client(pipePath, { debug: true })
    
    // Create a request that's too large (15KB)
    const hugeValue = 'y'.repeat(15_000)
    console.log(`Attempting request with size: ${hugeValue.length} bytes`)
    
    try {
      await client.set('huge', hugeValue)
      console.error('❌ Test 2 failed: Should have thrown too_large error')
      broker2.stop()
      process.exit(1)
    } catch (err) {
      if (err.message === 'too_large') {
        console.log('✅ Test 2 passed: Correctly rejected oversized request')
      } else {
        console.error('❌ Test 2 failed: Wrong error:', err.message)
        broker2.stop()
        process.exit(1)
      }
    }
    
    broker2.stop()
  } catch (err) {
    console.error('Test 2 setup failed:', err)
    broker2.stop()
    process.exit(1)
  }
  
  // Test 3: Default limits
  console.log('\nTest 3: Default limits')
  const testPipeId3 = 'test-defaults-' + Date.now()
  const broker3 = new Broker({ pipeId: testPipeId3, debug: false })
  
  try {
    const pipePath = await broker3.start()
    const client = new Client(pipePath)
    
    // Default maxValueSize is 256KB
    const value256KB = 'z'.repeat(256 * 1024)
    await client.set('max', value256KB)
    console.log('✅ 256KB value accepted (at default limit)')
    
    // Try slightly over default limit
    const value257KB = 'z'.repeat(257 * 1024)
    try {
      await client.set('over', value257KB)
      console.error('❌ Test 3 failed: Should reject value over default limit')
      broker3.stop()
      process.exit(1)
    } catch (err) {
      if (err.message === 'too_large') {
        console.log('✅ Test 3 passed: Default limits enforced correctly')
      } else {
        console.error('❌ Test 3 failed: Wrong error:', err.message)
        broker3.stop()
        process.exit(1)
      }
    }
    
    broker3.stop()
  } catch (err) {
    console.error('Test 3 failed:', err)
    broker3.stop()
    process.exit(1)
  }
  
  // Test 4: Non-string values
  console.log('\nTest 4: Non-string value size check')
  const testPipeId4 = 'test-object-' + Date.now()
  const broker4 = new Broker({ 
    pipeId: testPipeId4,
    maxValueSize: 1000, // 1KB
    debug: false
  })
  
  try {
    const pipePath = await broker4.start()
    const client = new Client(pipePath)
    
    // Create an object that serializes to more than 1KB
    const bigObject = {
      data: 'x'.repeat(2000) // Will be > 1KB when serialized
    }
    
    try {
      await client.set('obj', bigObject)
      console.error('❌ Test 4 failed: Should reject large serialized object')
      broker4.stop()
      process.exit(1)
    } catch (err) {
      if (err.message === 'too_large') {
        console.log('✅ Test 4 passed: Object size check works')
      } else {
        console.error('❌ Test 4 failed: Wrong error:', err.message)
        broker4.stop()
        process.exit(1)
      }
    }
    
    // Small object should work
    const smallObject = { data: 'small' }
    await client.set('smallobj', smallObject)
    console.log('✅ Small objects accepted correctly')
    
    broker4.stop()
  } catch (err) {
    console.error('Test 4 failed:', err)
    broker4.stop()
    process.exit(1)
  }
  
  console.log('\n✅ All size limit tests passed!')
}

testSizeLimits().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})