import { defineConfig } from '@playwright/test'
import { Broker } from 'ephemeral-broker'

let broker

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 5,
  reporter: 'list',
  use: {
    headless: true
  },

  // Global setup - start broker
  globalSetup: async () => {
    broker = new Broker({
      debug: true,
      requireTTL: false,
      secret: process.env.EPHEMERAL_SECRET || 'test-secret'
    })
    const pipe = await broker.start()
    console.log('✅ Broker started:', pipe)

    // Return teardown function
    return async () => {
      broker.stop()
      console.log('✅ Broker stopped')
    }
  }
})
