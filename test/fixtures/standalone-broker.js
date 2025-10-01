import { Broker } from '../../src/index.js'

// Create a standalone broker for testing signal handling
const broker = new Broker({ debug: false })

broker
  .start()
  .then(pipe => {
    // Output pipe path so test can verify cleanup
    console.log(`PIPE_PATH:${pipe}`)
    // Keep process alive until signal received
  })
  .catch(err => {
    console.error('Broker failed to start:', err)
    process.exit(1)
  })
