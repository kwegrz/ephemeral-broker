export default async function globalTeardown() {
  if (global.__BROKER__) {
    global.__BROKER__.stop()
    console.log('✅ Broker stopped')
  }
}
