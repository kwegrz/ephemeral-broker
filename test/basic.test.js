import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { Broker, Client } from '../src/index.js'

describe('Ephemeral Broker', () => {
  let broker
  let client
  let pipe

  before(async () => {
    broker = new Broker({ debug: false })
    pipe = await broker.start()
    client = new Client(pipe, { debug: false, allowNoTtl: true })
  })

  after(() => {
    broker.stop()
  })

  it('should start broker and get pipe path', () => {
    assert.ok(pipe)
    assert.match(pipe, /broker-.*\.sock|pipe/)
  })

  it('should set and get values', async () => {
    await client.set('foo', 'bar')
    const value = await client.get('foo')
    assert.strictEqual(value, 'bar')
  })

  it('should handle TTL expiration', async () => {
    await client.set('temp', 'value', 100)
    await new Promise(r => setTimeout(r, 150))
    await assert.rejects(() => client.get('temp'), /expired|not_found/)
  })

  it('should list items', async () => {
    await client.set('key1', 'value1')
    await client.set('key2', 'value2')
    const items = await client.list()
    assert.ok(items)
    assert.ok(items.key1 || items.key2)
  })

  it('should delete items', async () => {
    await client.set('todelete', 'value')
    await client.del('todelete')
    await assert.rejects(() => client.get('todelete'), /not_found/)
  })

  it('should respond to ping', async () => {
    const pong = await client.ping()
    assert.ok(typeof pong === 'number')
    assert.ok(pong > 0)
  })

  it('should handle JSON values', async () => {
    const obj = { nested: { data: [1, 2, 3] } }
    await client.set('json', obj)
    const result = await client.get('json')
    assert.deepStrictEqual(result, obj)
  })

  it('should reject not found keys', async () => {
    await assert.rejects(() => client.get('nonexistent'), /not_found/)
  })
})
