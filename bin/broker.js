#!/usr/bin/env node

import { Command } from 'commander'
import { Broker } from '../src/broker.js'

const program = new Command()

program
  .name('ephemeral-broker')
  .description('Ephemeral key-value broker for parallel test runners')
  .version('0.0.1')

program
  .command('start')
  .description('Start broker and run a command')
  .option('--ttl <ms>', 'Default TTL in milliseconds', parseInt, 30 * 60 * 1000)
  .option('--max-items <n>', 'Maximum number of items (0 = unlimited)', parseInt, 10000)
  .option('--max-request-size <bytes>', 'Maximum request size in bytes', parseInt, 1024 * 1024)
  .option('--max-value-size <bytes>', 'Maximum value size in bytes', parseInt, 256 * 1024)
  .option('--debug', 'Enable debug logging', false)
  .option('--pipe-id <id>', 'Custom pipe ID')
  .option('--secret <key>', 'HMAC secret key for authentication')
  .option('--no-require-ttl', 'Allow set() without TTL (not recommended for production)')
  .argument('[command...]', 'Command to run with the broker')
  .action(async (commandArgs, options) => {
    const broker = new Broker({
      defaultTTL: options.ttl,
      maxItems: options.maxItems,
      maxRequestSize: options.maxRequestSize,
      maxValueSize: options.maxValueSize,
      debug: options.debug,
      pipeId: options.pipeId,
      secret: options.secret,
      requireTTL: options.requireTtl
    })

    try {
      const pipe = await broker.start()

      if (options.debug) {
        console.log(`[broker] Started on: ${pipe}`)
      }

      if (commandArgs.length > 0) {
        // Run the command
        const [command, ...args] = commandArgs
        broker.spawn(command, args)
      } else {
        // No command - just keep broker running
        console.log(`Broker running on: ${pipe}`)
        console.log('Press Ctrl+C to stop')

        // Keep process alive
        await new Promise(() => {})
      }
    } catch (err) {
      console.error('Failed to start broker:', err.message)
      process.exit(1)
    }
  })

program.parse()
