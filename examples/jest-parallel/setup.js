import { Broker } from 'ephemeral-broker'

let broker

export default async function globalSetup() {
  broker = new Broker({
    debug: true,
    requireTTL: false,
    secret: process.env.EPHEMERAL_SECRET || 'test-secret'
  })

  const pipe = await broker.start()
  console.log('✅ Broker started:', pipe)

  // Store for teardown
  global.__BROKER__ = broker
}
