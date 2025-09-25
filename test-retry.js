import { Client } from './src/client.js'
import { Broker } from './src/broker.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const testPipe = path.join(os.tmpdir(), `test-retry-${Date.now()}.sock`)

async function testDelayedBrokerStart() {
  console.log('Testing: Client should retry and succeed when broker starts late')
  
  const broker = new Broker({ pipeId: 'test-retry', debug: false })
  const client = new Client(broker.pipe, { debug: true })
  
  // Start broker after 300ms delay and set initial value
  setTimeout(async () => {
    console.log('[test] Starting broker after delay...')
    await broker.start()
    // Use another client to set the value after broker starts
    const setupClient = new Client(broker.pipe, { debug: false })
    await setupClient.set('foo', 'bar')
  }, 300)
  
  try {
    const startTime = Date.now()
    const value = await client.get('foo')
    const elapsed = Date.now() - startTime
    
    console.log(`[test] SUCCESS: Got value '${value}' after ${elapsed}ms`)
    
    if (value === 'bar') {
      console.log('[test] ✓ Test passed: Client successfully retried and connected')
    } else {
      console.log(`[test] ✗ Test failed: Expected 'bar' but got '${value}'`)
    }
  } catch (err) {
    console.log(`[test] ✗ Test failed: ${err.message}`)
  } finally {
    await broker.stop()
  }
}

async function testMaxRetries() {
  console.log('\nTesting: Client should fail after max retries with no broker')
  
  const client = new Client(testPipe, { debug: true })
  
  const startTime = Date.now()
  try {
    await client.get('foo')
    console.log('[test] ✗ Test failed: Should have thrown an error')
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.log(`[test] Error after ${elapsed}ms: ${err.message}`)
    
    // Total delay should be around 1550ms (50 + 100 + 200 + 400 + 800)
    if (elapsed >= 1500 && elapsed < 2000) {
      console.log('[test] ✓ Test passed: Client failed after correct retry delays')
    } else {
      console.log(`[test] ⚠ Warning: Unexpected timing (expected ~1550ms)`)
    }
    
    // Check that original error is preserved
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
      console.log(`[test] ✓ Original error preserved: ${err.code}`)
    } else {
      console.log(`[test] ✗ Unexpected error code: ${err.code}`)
    }
  }
}

async function testImmediateConnection() {
  console.log('\nTesting: Client should connect immediately when broker is running')
  
  const broker = new Broker({ pipeId: 'test-immediate', debug: false })
  await broker.start()
  
  // Use client to set the value
  const setupClient = new Client(broker.pipe, { debug: false })
  await setupClient.set('test', 'immediate')
  
  const client = new Client(broker.pipe, { debug: false })
  
  try {
    const startTime = Date.now()
    const value = await client.get('test')
    const elapsed = Date.now() - startTime
    
    if (value === 'immediate' && elapsed < 100) {
      console.log(`[test] ✓ Test passed: Immediate connection (${elapsed}ms)`)
    } else {
      console.log(`[test] ✗ Test failed: Took ${elapsed}ms or wrong value`)
    }
  } catch (err) {
    console.log(`[test] ✗ Test failed: ${err.message}`)
  } finally {
    await broker.stop()
  }
}

async function runTests() {
  console.log('=== Running Retry Logic Tests ===\n')
  
  await testDelayedBrokerStart()
  await testMaxRetries()
  await testImmediateConnection()
  
  console.log('\n=== Tests Complete ===')
}

runTests().catch(console.error)