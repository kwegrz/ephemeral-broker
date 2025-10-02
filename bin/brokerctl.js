#!/usr/bin/env node

import { Command } from 'commander'
import { Client } from '../src/client.js'

const program = new Command()

program
  .name('brokerctl')
  .description('CLI client for ephemeral-broker')
  .version('0.0.1')
  .option('--pipe <path>', 'Broker pipe path (defaults to EPHEMERAL_PIPE env var)')
  .option('--secret <key>', 'HMAC secret (defaults to EPHEMERAL_SECRET env var)')

// Get command
program
  .command('get <key>')
  .description('Get a value by key')
  .action(async key => {
    try {
      const client = createClient(program.opts())
      const value = await client.get(key)
      console.log(value)
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Set command
program
  .command('set <key> <value>')
  .description('Set a key-value pair')
  .option('--ttl <ms>', 'TTL in milliseconds', parseInt)
  .action(async (key, value, options) => {
    try {
      const client = createClient(program.opts())
      await client.set(key, value, options.ttl)
      console.log('OK')
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Del command
program
  .command('del <key>')
  .description('Delete a key')
  .action(async key => {
    try {
      const client = createClient(program.opts())
      await client.del(key)
      console.log('OK')
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// List command
program
  .command('list')
  .description('List all keys')
  .action(async () => {
    try {
      const client = createClient(program.opts())
      const items = await client.list()
      console.log(JSON.stringify(items, null, 2))
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Stats command
program
  .command('stats')
  .description('Show broker statistics')
  .action(async () => {
    try {
      const client = createClient(program.opts())
      const stats = await client.stats()
      console.log(JSON.stringify(stats, null, 2))
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Ping command
program
  .command('ping')
  .description('Ping the broker')
  .action(async () => {
    try {
      const client = createClient(program.opts())
      const start = Date.now()
      await client.ping()
      const duration = Date.now() - start
      console.log(`pong (${duration}ms)`)
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Lease command
program
  .command('lease <key> <workerId>')
  .description('Lease a unique value for a worker')
  .option('--ttl <ms>', 'TTL in milliseconds', parseInt)
  .action(async (key, workerId, options) => {
    try {
      const client = createClient(program.opts())
      const value = await client.lease(key, workerId, options.ttl)
      console.log(value)
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

// Release command
program
  .command('release <workerId>')
  .description('Release a worker lease')
  .action(async workerId => {
    try {
      const client = createClient(program.opts())
      const released = await client.release(workerId)
      console.log(released ? 'OK' : 'NOT_FOUND')
      process.exit(0)
    } catch (err) {
      handleError(err)
    }
  })

function createClient(opts) {
  return new Client(opts.pipe, {
    secret: opts.secret,
    allowNoTtl: true, // brokerctl allows operations without TTL for debugging
    debug: false
  })
}

function handleError(err) {
  if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
    console.error('Error: Broker not running or pipe not found')
    console.error('Make sure EPHEMERAL_PIPE is set or use --pipe option')
  } else {
    console.error(`Error: ${err.message}`)
  }
  process.exit(1)
}

program.parse()
