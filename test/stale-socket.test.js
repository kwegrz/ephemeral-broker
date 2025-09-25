import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Broker } from '../src/broker.js'

async function testStaleSocketCleanup() {
  console.log('Testing stale socket cleanup...')
  
  // Skip on Windows (no socket files to clean)
  if (process.platform === 'win32') {
    console.log('Skipping on Windows - named pipes don\'t leave files')
    return
  }
  
  // Test Case 1: Stale socket file removal
  const testPipeId = 'test-stale-' + Date.now()
  const sockPath = path.join(os.tmpdir(), `broker-${testPipeId}.sock`)
  
  // Create fake stale socket file
  fs.writeFileSync(sockPath, '')
  console.log(`Created fake stale socket at: ${sockPath}`)
  
  // Create broker and start it
  const broker = new Broker({ pipeId: testPipeId, debug: true })
  
  try {
    await broker.start()
    console.log('✅ Test 1 passed: Broker started after removing stale socket')
    
    // Clean up
    broker.stop()
  } catch (err) {
    console.error('❌ Test 1 failed:', err.message)
    process.exit(1)
  }
  
  // Test Case 2: Already running broker detection
  console.log('\nTesting already running broker detection...')
  
  const testPipeId2 = 'test-running-' + Date.now()
  const broker1 = new Broker({ pipeId: testPipeId2, debug: true })
  const broker2 = new Broker({ pipeId: testPipeId2, debug: true })
  
  try {
    // Start first broker
    await broker1.start()
    console.log('First broker started')
    
    // Try to start second broker with same pipe
    try {
      await broker2.start()
      console.error('❌ Test 2 failed: Second broker should not start')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Broker already running') {
        console.log('✅ Test 2 passed: Correctly detected already running broker')
      } else {
        console.error('❌ Test 2 failed: Wrong error:', err.message)
        process.exit(1)
      }
    }
    
    // Clean up
    broker1.stop()
  } catch (err) {
    console.error('❌ Test setup failed:', err.message)
    process.exit(1)
  }
  
  console.log('\n✅ All tests passed!')
}

// Run tests
testStaleSocketCleanup().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})