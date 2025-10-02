import { Broker } from 'ephemeral-broker'

let broker

export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.js'],
  maxInstances: 5,

  capabilities: [
    {
      maxInstances: 5,
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless', '--disable-gpu']
      }
    }
  ],

  logLevel: 'info',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  },

  // Start broker before all tests
  async onPrepare() {
    broker = new Broker({
      debug: true,
      requireTTL: false,
      secret: process.env.EPHEMERAL_SECRET || 'test-secret'
    })
    await broker.start()
    console.log('✅ Broker started:', broker.pipe)
  },

  // Stop broker after all tests
  async onComplete() {
    if (broker) {
      broker.stop()
      console.log('✅ Broker stopped')
    }
  }
}
