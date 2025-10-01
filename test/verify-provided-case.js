import fs from 'node:fs'
import { Broker } from '../src/broker.js'

// Test the exact case provided in requirements
async function testProvidedCase() {
  console.log('Testing provided test case...')

  // Skip on Windows
  if (process.platform === 'win32') {
    console.log("Skipping on Windows - named pipes don't leave files")
    return
  }

  // Create fake stale socket as specified
  fs.writeFileSync('/tmp/broker-test.sock', '')
  console.log('Created fake stale socket at /tmp/broker-test.sock')

  const broker = new Broker({ pipeId: 'test' })

  try {
    await broker.start() // Should remove stale and start successfully
    console.log('✅ Broker started successfully after removing stale socket')

    // Verify socket file now exists with actual server
    if (fs.existsSync('/tmp/broker-test.sock')) {
      console.log('✅ Socket file exists with running server')
    }

    // Clean up
    broker.stop()
    console.log('✅ Test case passed!')
  } catch (err) {
    console.error('❌ Test case failed:', err.message)
    process.exit(1)
  }
}

testProvidedCase().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
